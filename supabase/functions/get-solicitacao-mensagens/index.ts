// Deploy: manter verify_jwt=false no dashboard/CLI (mesmo padrão do projeto).
// O gateway com verify_jwt=true rejeita sessões JWT ES256 do GoTrue;
// a validação fica em auth.getUser() dentro do handler.
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
    const hasPermission = permissionsData?.some((p: { permission_key: string }) =>
      p.permission_key === "contracts.solicitacoes.read" ||
      p.permission_key === "contracts.solicitacoes.write" ||
      p.permission_key === "contracts.solicitacoes.*" ||
      p.permission_key === "contracts.*" ||
      p.permission_key === "*"
    );

    if (!hasPermission) {
      return new Response(JSON.stringify({ error: "Sem permissão para ver mensagens" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = new URL(req.url);
    const solicitacaoId = url.searchParams.get("solicitacao_id");

    if (!solicitacaoId) {
      return new Response(JSON.stringify({ error: "solicitacao_id é obrigatório" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: mensagens, error } = await supabase
      .schema("contracts")
      .from("solicitacao_mensagens")
      .select("id, mensagem, created_at, autor_id")
      .eq("solicitacao_id", solicitacaoId)
      .order("created_at", { ascending: true });

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Resolve autores em query separada (evita join cross-schema contracts→people)
    const autorIds = [...new Set((mensagens ?? []).map((m) => m.autor_id).filter(Boolean))];
    let autoresMap: Record<string, { id: string; nome_completo: string }> = {};

    if (autorIds.length > 0) {
      const { data: autores } = await supabase
        .schema("people")
        .from("colaboradores")
        .select("id, nome_completo")
        .in("id", autorIds);

      if (autores) {
        autoresMap = Object.fromEntries(autores.map((a) => [a.id, a]));
      }
    }

    const data = (mensagens ?? []).map((m) => ({
      ...m,
      autor: autoresMap[m.autor_id] ?? null,
    }));

    return new Response(JSON.stringify({ data }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
