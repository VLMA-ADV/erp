import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: permissionsData } = await supabase.rpc("get_user_permissions", { p_user_id: user.id });
    const hasPermission = permissionsData?.some((p: any) =>
      p.permission_key === "contracts.contratos.read" ||
      p.permission_key === "contracts.contratos.write" ||
      p.permission_key === "contracts.*" ||
      p.permission_key === "*"
    );

    if (!hasPermission) {
      return new Response(JSON.stringify({ error: "Você não tem permissão para acessar opções de contrato" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data, error } = await supabase.rpc("get_contrato_form_options", { p_user_id: user.id });
    if (error) {
      return new Response(JSON.stringify({ error: error.message, details: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const normalizedData = data ?? {};
    const { data: tenantUserData } = await supabase.rpc("get_user_tenant", { p_user_id: user.id });
    const tenantId = tenantUserData?.[0]?.tenant_id as string | undefined;

    if (!Array.isArray((normalizedData as any).cargos) || (normalizedData as any).cargos.length === 0) {
      try {
        const { data: cargosRpcData } = await supabase.rpc("get_cargos", { p_user_id: user.id });
        const ativosViaRpc = (cargosRpcData ?? [])
          .filter((c: any) => c?.ativo === true)
          .map((c: any) => ({ id: c.id, nome: c.nome }));

        if (ativosViaRpc.length > 0) {
          (normalizedData as any).cargos = ativosViaRpc;
        } else {
          const { data: tenantUserData } = await supabase.rpc("get_user_tenant", { p_user_id: user.id });
          const tenantId = tenantUserData?.[0]?.tenant_id as string | undefined;

          if (tenantId) {
            const { data: cargosData } = await supabase
              .schema("people")
              .from("cargos")
              .select("id,nome,ativo")
              .eq("tenant_id", tenantId)
              .eq("ativo", true)
              .order("nome", { ascending: true });

            (normalizedData as any).cargos = (cargosData ?? []).map((c: any) => ({ id: c.id, nome: c.nome }));
          } else {
            (normalizedData as any).cargos = [];
          }
        }
      } catch (_fallbackError) {
        (normalizedData as any).cargos = [];
      }
    }

    if (!Array.isArray((normalizedData as any).tabelas_preco)) {
      (normalizedData as any).tabelas_preco = [];
    }

    if (Array.isArray((normalizedData as any).colaboradores)) {
      (normalizedData as any).colaboradores = (normalizedData as any).colaboradores.filter((item: any) => item?.ativo !== false);
    }

    if (
      (!Array.isArray((normalizedData as any).colaboradores) || (normalizedData as any).colaboradores.length === 0) &&
      tenantId
    ) {
      try {
        const { data: colaboradoresData } = await supabase
          .schema("people")
          .from("colaboradores")
          .select("id,nome,categoria,ativo")
          .eq("tenant_id", tenantId)
          .eq("ativo", true)
          .order("nome", { ascending: true });

        (normalizedData as any).colaboradores = (colaboradoresData ?? []).map((colaborador: any) => ({
          id: colaborador.id,
          nome: colaborador.nome,
          categoria: colaborador.categoria ?? undefined,
          ativo: colaborador.ativo,
        }));
      } catch (_colaboradoresError) {
        (normalizedData as any).colaboradores = [];
      }
    }

    if (!Array.isArray((normalizedData as any).servicos)) {
      try {
        const { data: servicosData } = await supabase.rpc("get_servicos", { p_user_id: user.id });
        (normalizedData as any).servicos = (servicosData ?? []).map((s: any) => ({ id: s.id, nome: s.nome }));
      } catch (_servicosError) {
        (normalizedData as any).servicos = [];
      }
    }

    if (!Array.isArray((normalizedData as any).prestadores)) {
      try {
        const { data: prestadoresData } = await supabase.rpc("get_prestadores", {
          p_user_id: user.id,
          p_search: null,
        });
        (normalizedData as any).prestadores = (prestadoresData ?? [])
          .filter((p: any) => p?.ativo !== false)
          .map((p: any) => ({ id: p.id, nome: p.nome }));
      } catch (_prestadoresError) {
        (normalizedData as any).prestadores = [];
      }
    }

    if (!Array.isArray((normalizedData as any).parceiros)) {
      try {
        const { data: parceirosData } = await supabase.rpc("get_parceiros", {
          p_user_id: user.id,
          p_search: null,
        });
        (normalizedData as any).parceiros = (parceirosData ?? [])
          .filter((p: any) => p?.ativo !== false)
          .map((p: any) => ({ id: p.id, nome: p.nome_escritorio || p.nome || "Parceiro" }));
      } catch (_parceirosError) {
        (normalizedData as any).parceiros = [];
      }
    }

    return new Response(JSON.stringify({ data: normalizedData }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
