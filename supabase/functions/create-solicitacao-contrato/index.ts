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
      p.permission_key === "contracts.solicitacoes.write" ||
      p.permission_key === "contracts.solicitacoes.*" ||
      p.permission_key === "contracts.*" ||
      p.permission_key === "*"
    );

    if (!hasPermission) {
      return new Response(JSON.stringify({ error: "Você não tem permissão para criar solicitação" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const payload = await req.json();
    const { data, error } = await supabase.rpc("create_solicitacao_contrato", {
      p_user_id: user.id,
      p_payload: payload,
    });

    if (error) {
      return new Response(JSON.stringify({ error: error.message, details: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let result = data as Record<string, unknown> | null;
    const solicitacaoId = typeof result?.id === "string" ? result.id : null;
    const hasContrato = typeof result?.contrato_id === "string" && result.contrato_id.length > 0;

    // RF-011: rascunho idempotente (falha não bloqueia a solicitação)
    if (solicitacaoId) {
      try {
        const { data: rascunhoId, error: rascunhoErr } = await supabase.rpc(
          "link_contrato_rascunho_para_solicitacao",
          { p_solicitacao_id: solicitacaoId, p_user_id: user.id },
        );
        if (!rascunhoErr && typeof rascunhoId === "string" && rascunhoId.length > 0) {
          result = { ...(result || {}), contrato_rascunho_id: rascunhoId };
        } else if (rascunhoErr) {
          console.error("link_contrato_rascunho_para_solicitacao:", rascunhoErr);
        }
      } catch (e) {
        console.error("RF-011 rascunho exception:", e);
      }
    }

    // Fallback defensivo: se a RPC antiga não criar o contrato em solicitação,
    // a edge garante a criação e o vínculo para manter o fluxo esperado.
    if (solicitacaoId && !hasContrato) {
      const { data: solicitacao, error: solicitacaoError } = await supabase
        .schema("contracts")
        .from("solicitacoes_contrato")
        .select("id, tenant_id, cliente_id, descricao, contrato_id")
        .eq("id", solicitacaoId)
        .maybeSingle();

      if (!solicitacaoError && solicitacao?.cliente_id && !solicitacao.contrato_id) {
        const nomeBase =
          typeof payload?.nome === "string" && payload.nome.trim().length > 0
            ? payload.nome.trim()
            : (solicitacao.descricao || "Pré-cadastro de contrato");

        // Tenta inserir; se nome duplicado, adiciona sufixo incremental
        let contratoCriado: { id: string } | null = null;
        let contratoError: any = null;
        for (let attempt = 0; attempt < 5; attempt++) {
          const nomeContrato = attempt === 0 ? nomeBase : `${nomeBase} (${attempt + 1})`;
          const result = await supabase
            .schema("contracts")
            .from("contratos")
            .insert({
              tenant_id: solicitacao.tenant_id,
              cliente_id: solicitacao.cliente_id,
              nome_contrato: nomeContrato,
              status: "rascunho",
              forma_entrada: "organico",
              created_by: user.id,
              updated_by: user.id,
            })
            .select("id")
            .single();
          if (!result.error) {
            contratoCriado = result.data;
            contratoError = null;
            break;
          }
          if (result.error.message?.includes("idx_contratos_tenant_nome_unique")) {
            contratoError = result.error;
            continue;
          }
          contratoError = result.error;
          break;
        }

        if (!contratoError && contratoCriado?.id) {
          const { data: anexosSolicitacao } = await supabase
            .schema("contracts")
            .from("solicitacoes_contrato_anexos")
            .select("nome, arquivo_nome, mime_type, tamanho_bytes, arquivo")
            .eq("solicitacao_id", solicitacaoId);

          if (Array.isArray(anexosSolicitacao) && anexosSolicitacao.length > 0) {
            await supabase
              .schema("contracts")
              .from("contrato_anexos")
              .insert(
                anexosSolicitacao.map((anexo: any) => ({
                  tenant_id: solicitacao.tenant_id,
                  contrato_id: contratoCriado.id,
                  nome: "Proposta",
                  arquivo_nome: anexo.arquivo_nome,
                  mime_type: anexo.mime_type,
                  tamanho_bytes: anexo.tamanho_bytes,
                  arquivo: anexo.arquivo,
                  created_by: user.id,
                })),
              );
          }

          await supabase
            .schema("contracts")
            .from("solicitacoes_contrato")
            .update({
              contrato_id: contratoCriado.id,
              updated_by: user.id,
            })
            .eq("id", solicitacaoId);

          result = { ...(result || {}), contrato_id: contratoCriado.id };
        }
      }
    }

    return new Response(JSON.stringify({ data: result }), {
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
