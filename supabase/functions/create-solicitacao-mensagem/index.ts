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
      p.permission_key === "contracts.solicitacoes.write" ||
      p.permission_key === "contracts.solicitacoes.*" ||
      p.permission_key === "contracts.*" ||
      p.permission_key === "*"
    );

    if (!hasPermission) {
      return new Response(JSON.stringify({ error: "Sem permissão para enviar mensagens" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { solicitacao_id, mensagem } = body as { solicitacao_id?: string; mensagem?: string };

    if (!solicitacao_id || typeof solicitacao_id !== "string") {
      return new Response(JSON.stringify({ error: "solicitacao_id é obrigatório" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!mensagem || typeof mensagem !== "string" || mensagem.trim().length === 0) {
      return new Response(JSON.stringify({ error: "mensagem é obrigatória" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Resolve colaborador_id e tenant_id a partir do user_id
    const { data: colaborador, error: colaboradorError } = await supabase
      .schema("people")
      .from("colaboradores")
      .select("id, tenant_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (colaboradorError || !colaborador) {
      return new Response(JSON.stringify({ error: "Colaborador não encontrado para o usuário" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data, error } = await supabase
      .schema("contracts")
      .from("solicitacao_mensagens")
      .insert({
        solicitacao_id,
        autor_id: colaborador.id,
        mensagem: mensagem.trim(),
        tenant_id: colaborador.tenant_id,
      })
      .select("id, mensagem, created_at, autor_id")
      .single();

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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
