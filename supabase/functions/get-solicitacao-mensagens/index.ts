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

    // Visibilidade + autor + status via RPC SECURITY DEFINER:
    // usuário comum vê só as próprias; financeiro (admin/sócio) vê todas.
    const { data: result, error } = await supabase.rpc("get_solicitacao_mensagens", {
      p_user_id: user.id,
      p_solicitacao_id: solicitacaoId,
    });

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const payload = (result ?? {}) as { can_manage?: boolean; mensagens?: unknown };
    return new Response(JSON.stringify({ data: payload.mensagens ?? [], can_manage: payload.can_manage ?? false }), {
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
