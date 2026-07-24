// Deploy: manter verify_jwt=false no dashboard/CLI (mesmo padrão do projeto).
// O gateway com verify_jwt=true rejeita sessões JWT ES256 do GoTrue;
// a validação fica em auth.getUser() dentro do handler.
//
// Suporta dois fluxos:
//  1. Mensagem em solicitacao_contrato existente (legacy): body { solicitacao_id, mensagem }
//  2. Mensagem avulsa (Feature F): body { cliente_id, caso_id, mensagem, anexos? } — sem solicitacao_id.
//     Roteado para a RPC public.create_mensagem_avulsa (que faz validações e decode(base64)).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonRes(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonRes({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonRes({ error: "Missing authorization header" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) return jsonRes({ error: "Invalid token" }, 401);

    const { data: permissionsData } = await supabase.rpc("get_user_permissions", { p_user_id: user.id });
    const hasPermission = permissionsData?.some((p: { permission_key: string }) =>
      p.permission_key === "contracts.solicitacoes.write" ||
      p.permission_key === "contracts.solicitacoes.*" ||
      p.permission_key === "contracts.*" ||
      p.permission_key === "*"
    );
    if (!hasPermission) return jsonRes({ error: "Sem permissão para enviar mensagens" }, 403);

    const body = await req.json().catch(() => ({}));
    const solicitacaoId = typeof body?.solicitacao_id === "string" && body.solicitacao_id.trim().length > 0
      ? body.solicitacao_id.trim()
      : null;

    if (!solicitacaoId) {
      const { data, error } = await supabase.rpc("create_mensagem_avulsa", {
        p_user_id: user.id,
        p_payload: body,
      });
      if (error) {
        const msg = String(error.message || "");
        const isBusinessValidation =
          msg.includes("é obrigatória") ||
          msg.includes("não encontrado") ||
          msg.includes("não associado") ||
          msg.includes("Selecione ao menos um vínculo");
        return jsonRes(
          { error: msg, details: msg },
          isBusinessValidation ? 400 : 500,
        );
      }
      return jsonRes({ data });
    }

    const mensagem = typeof body?.mensagem === "string" ? body.mensagem.trim() : "";
    if (!mensagem) return jsonRes({ error: "mensagem é obrigatória" }, 400);

    const { data: colaborador, error: colaboradorError } = await supabase
      .schema("people")
      .from("colaboradores")
      .select("id, tenant_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (colaboradorError || !colaborador) {
      return jsonRes({ error: "Colaborador não encontrado para o usuário" }, 400);
    }

    const { data: insertedMessage, error: insertError } = await supabase
      .schema("contracts")
      .from("solicitacao_mensagens")
      .insert({
        solicitacao_id: solicitacaoId,
        autor_id: colaborador.id,
        mensagem,
        tenant_id: colaborador.tenant_id,
      })
      .select("id, mensagem, created_at, autor_id")
      .single();

    if (insertError || !insertedMessage) {
      return jsonRes({ error: insertError?.message ?? "Erro ao salvar mensagem" }, 500);
    }

    const { data: autor } = await supabase
      .schema("people")
      .from("colaboradores")
      .select("id, nome_completo")
      .eq("id", colaborador.id)
      .maybeSingle();

    return jsonRes({
      data: {
        ...insertedMessage,
        autor: autor ?? null,
      },
    });
  } catch (error) {
    return jsonRes({ error: (error as Error).message }, 500);
  }
});
