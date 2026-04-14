import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { createAuditLog, getIpAddress, getUserAgent } from "../_shared/audit-log.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function sanitizeRuleConfig(ruleConfig: any) {
  if (!ruleConfig || typeof ruleConfig !== "object" || Array.isArray(ruleConfig)) return ruleConfig;
  const { numero_processos: _ignored, ...rest } = ruleConfig;
  return rest;
}

function sanitizeCaso(caso: any) {
  if (!caso || typeof caso !== "object" || Array.isArray(caso)) return caso;
  const nextCaso = { ...caso };
  nextCaso.regra_cobranca_config = sanitizeRuleConfig(nextCaso.regra_cobranca_config);
  if (Array.isArray(nextCaso.regras_financeiras)) {
    nextCaso.regras_financeiras = nextCaso.regras_financeiras.map((rule: any) => {
      if (!rule || typeof rule !== "object" || Array.isArray(rule)) return rule;
      const sanitizedRule = { ...rule };
      sanitizedRule.regra_cobranca_config = sanitizeRuleConfig(sanitizedRule.regra_cobranca_config);
      return sanitizedRule;
    });
  }
  return nextCaso;
}

function sanitizeContratoPayload(payload: any) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  const next = { ...payload };
  if (next.status === "em_analise") {
    next.status = "validacao";
  }
  if (Array.isArray(next.casos)) {
    next.casos = next.casos.map((caso: any) => sanitizeCaso(caso));
  }
  return next;
}

/** Garante nome_contrato quando o cliente envia null antes do React aplicar numero_sequencial (RF-064). */
function normalizeNomeContratoForUpdate(payload: any, previous: any) {
  if (!payload || typeof payload !== "object") return;
  const explicit = typeof payload.nome_contrato === "string" ? payload.nome_contrato.trim() : "";
  if (explicit) {
    payload.nome_contrato = explicit;
    return;
  }
  const seqPayload = Number(payload.numero_sequencial ?? 0);
  const prevRow = previous && typeof previous === "object" && !Array.isArray(previous) ? previous : null;
  const seqPrev = Number(prevRow?.numero_sequencial ?? 0);
  const seq = Number.isFinite(seqPayload) && seqPayload > 0 ? seqPayload : seqPrev;
  if (Number.isFinite(seq) && seq > 0) {
    payload.nome_contrato = `Contrato ${seq}`;
    return;
  }
  const prevNome = typeof prevRow?.nome_contrato === "string" ? prevRow.nome_contrato.trim() : "";
  if (prevNome) payload.nome_contrato = prevNome;
}

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

    const body = await req.json();
    if (!body.id) {
      return new Response(JSON.stringify({ error: "ID do contrato é obrigatório" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: tenantUserData } = await supabase.rpc("get_user_tenant", { p_user_id: user.id });
    const tenantUser = tenantUserData?.[0];

    const { data: permissionsData } = await supabase.rpc("get_user_permissions", { p_user_id: user.id });
    const hasPermission = permissionsData?.some((p: any) =>
      p.permission_key === "contracts.contratos.write" ||
      p.permission_key === "contracts.contratos.*" ||
      p.permission_key === "contracts.*" ||
      p.permission_key === "*"
    );
    if (!hasPermission) {
      return new Response(JSON.stringify({ error: "Você não tem permissão para editar contratos" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: previous } = await supabase.rpc("get_contrato", {
      p_user_id: user.id,
      p_contrato_id: body.id,
    });

    const sanitizedBody = sanitizeContratoPayload(body);
    normalizeNomeContratoForUpdate(sanitizedBody, previous);
    const { data, error } = await supabase.rpc("update_contrato", {
      p_user_id: user.id,
      p_contrato_id: sanitizedBody.id,
      p_payload: sanitizedBody,
    });

    if (error) {
      return new Response(JSON.stringify({ error: error.message, details: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (tenantUser?.tenant_id && Object.prototype.hasOwnProperty.call(sanitizedBody, "responsavel_prospeccao_id")) {
      const { error: syncError } = await supabase
        .schema("contracts")
        .from("contratos")
        .update({
          responsavel_prospeccao_id:
            sanitizedBody.forma_entrada === "prospeccao"
              ? sanitizedBody.responsavel_prospeccao_id || null
              : null,
        })
        .eq("id", sanitizedBody.id)
        .eq("tenant_id", tenantUser.tenant_id);

      if (syncError) {
        return new Response(JSON.stringify({ error: syncError.message, details: syncError.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    if (tenantUser?.tenant_id) {
      await createAuditLog({
        supabase,
        tenantId: tenantUser.tenant_id,
        tipoEntidade: "contracts.contratos",
        entidadeId: sanitizedBody.id,
        acao: "update",
        userId: user.id,
        dadosAnteriores: previous,
        dadosNovos: sanitizedBody,
        ipAddress: getIpAddress(req),
        userAgent: getUserAgent(req),
      });
    }

    return new Response(JSON.stringify({ data }), {
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
