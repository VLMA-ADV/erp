import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const FOTO_BUCKET = "colaboradores-fotos";

// Extrai o caminho do objeto no bucket a partir do foto_url armazenado, que pode
// estar em 2 formatos: URL pública antiga (.../colaboradores-fotos/<path>?v=) ou
// já o próprio path (uploads novos). Retorna null se não houver foto.
function fotoPath(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = String(v).split("?")[0];
  const marker = "/colaboradores-fotos/";
  const i = s.indexOf(marker);
  if (i >= 0) return s.slice(i + marker.length);
  if (!/^https?:\/\//i.test(s)) return s; // já é um path
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Get query parameters
    const url = new URL(req.url);
    const search = url.searchParams.get("search") || "";
    const page = parseInt(url.searchParams.get("page") || "1");
    const limit = parseInt(url.searchParams.get("limit") || "10");
    const areaId = url.searchParams.get("area_id") || "";
    const offset = (page - 1) * limit;

    // Autenticação OBRIGATÓRIA. Antes, sem Authorization o tenant vinha de um
    // query param (?tenant_id=) ou de um fallback que pegava o 1º tenant, expondo
    // a folha de pagamento (salário) sem login. Agora o tenant é SEMPRE derivado
    // do usuário autenticado.
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let tenantId = "";
    let canSeeSalario = false;
    {
      const token = authHeader.replace("Bearer ", "");
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser(token);

      if (userError || !user) {
        console.error("Token verification error:", userError);
        return new Response(
          JSON.stringify({ error: "Invalid token", details: userError?.message }),
          {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      console.log("User verified:", user.id);

      // Get user's tenant - usar função RPC
      const { data: tenantUserData, error: tenantError } = await supabase
        .rpc('get_user_tenant', { p_user_id: user.id });

      const tenantUser = tenantUserData && tenantUserData.length > 0
        ? { tenant_id: tenantUserData[0].tenant_id }
        : null;

      if (tenantError) {
        console.error("Tenant error:", tenantError);
        console.error("User ID:", user.id);
        return new Response(
          JSON.stringify({
            error: "User not associated with tenant",
            details: tenantError.message,
            user_id: user.id
          }),
          {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      if (!tenantUser) {
        console.error("No tenant found for user:", user.id);
        return new Response(
          JSON.stringify({
            error: "User not associated with tenant",
            user_id: user.id
          }),
          {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      tenantId = tenantUser.tenant_id;

      // Salário e adicional são folha de pagamento. Só quem tem a capacidade
      // 'people.salario.read' (sócios + Jessika Lira) enxerga esses campos;
      // para os demais, são zerados abaixo. Antes, qualquer logado via a folha.
      const { data: canSalarioData } = await supabase.rpc(
        "tem_capacidade_sensivel",
        { p_user_id: user.id, p_capacidade: "people.salario.read" },
      );
      canSeeSalario = canSalarioData === true;
    }

    if (!tenantId) {
      return new Response(
        JSON.stringify({ error: "Unable to resolve tenant_id" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Sempre via RPC (schema people não é exposto ao PostgREST). O filtro por
    // área (centro de custo) e o total vêm da própria RPC (total_count).
    const result = await supabase.rpc('list_colaboradores', {
      p_tenant_id: tenantId,
      p_search: search || null,
      p_page: page,
      p_limit: limit,
      p_area_id: areaId || null,
    });
    const data: any[] | null = result.data;
    const queryError: any = result.error;

    const totalCount = Array.isArray(data) && data.length > 0 ? Number(data[0].total_count || 0) : 0;

    // Transformar dados para o formato esperado
    const transformedData = data?.map((item: any) => ({
      id: item.id,
      nome: item.nome,
      email: item.email,
      whatsapp: item.whatsapp,
      ativo: item.ativo,
      cargo_id: item.cargo_id,
      cargo: item.cargo_nome ? { nome: item.cargo_nome } : null,
      foto_url: item.foto_url ?? null,
      salario: canSeeSalario ? (item.salario ?? null) : null,
      categoria: item.categoria ?? null,
      area_id: item.area_id ?? null,
      area_nome: item.area_nome ?? null,
      adicional: canSeeSalario ? (item.adicional ?? null) : null,
      eh_coordenador: item.eh_coordenador ?? false,
    })) || [];

    // Bucket privado: troca a foto (URL pública ou path) por uma signed URL
    // temporária (1h). createSignedUrls é em lote (1 chamada) e usa service role
    // (ignora RLS). Se falhar para algum path, mantém o valor original.
    try {
      const pathByIndex = transformedData.map((d: any) => fotoPath(d.foto_url));
      const paths = Array.from(new Set(pathByIndex.filter(Boolean))) as string[];
      if (paths.length > 0) {
        const { data: signed } = await supabase.storage.from(FOTO_BUCKET).createSignedUrls(paths, 3600);
        const byPath = new Map<string, string>();
        for (const s of signed || []) {
          if ((s as any).signedUrl && (s as any).path) byPath.set((s as any).path, (s as any).signedUrl);
        }
        transformedData.forEach((d: any, idx: number) => {
          const p = pathByIndex[idx];
          if (p && byPath.has(p)) d.foto_url = byPath.get(p);
        });
      }
    } catch (e) {
      console.error("Erro ao assinar fotos:", e);
    }

    if (queryError) {
      console.error("Query error:", queryError);
      return new Response(
        JSON.stringify({ error: queryError.message }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Usar total real se a query de count funcionou, senão estimar pelo tamanho da página
    const total = totalCount > 0 ? totalCount : transformedData.length;

    console.log("Returning", transformedData?.length || 0, "colaboradores (total:", total, ")");

    return new Response(
      JSON.stringify({
        data: transformedData,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Unexpected error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
