import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { normalizeContratoStatusForWrite } from "../_shared/contrato-status.ts";
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
  const normalizedStatus = normalizeContratoStatusForWrite(typeof next.status === "string" ? next.status : undefined);
  if (normalizedStatus) {
    next.status = normalizedStatus;
  }
  if (Array.isArray(next.casos)) {
    next.casos = next.casos.map((caso: any) => sanitizeCaso(caso));
  }
  return next;
}

function normalizeContractName(payload: any) {
  const explicitName = typeof payload?.nome_contrato === "string" ? payload.nome_contrato.trim() : "";
  const sequentialNumber = Number(payload?.numero_sequencial ?? 0);
  const generatedName = Number.isFinite(sequentialNumber) && sequentialNumber > 0
    ? `Contrato ${sequentialNumber}`
    : "";
  return explicitName || generatedName;
}

async function hydrateCreatedContrato(supabase: ReturnType<typeof createClient>, contratoId: string) {
  const { data } = await supabase
    .schema("contracts")
    .from("contratos")
    .select("id, nome_contrato, numero_sequencial")
    .eq("id", contratoId)
    .maybeSingle();

  return data ?? null;
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

    const { data: tenantUserData } = await supabase.rpc("get_user_tenant", { p_user_id: user.id });
    const tenantUser = tenantUserData?.[0];
    if (!tenantUser) {
      return new Response(JSON.stringify({ error: "User not associated with tenant" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: permissionsData } = await supabase.rpc("get_user_permissions", { p_user_id: user.id });
    const hasPermission = permissionsData?.some((p: any) =>
      p.permission_key === "contracts.contratos.write" ||
      p.permission_key === "contracts.contratos.*" ||
      p.permission_key === "contracts.*" ||
      p.permission_key === "*"
    );

    if (!hasPermission) {
      return new Response(JSON.stringify({ error: "Você não tem permissão para criar contratos" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const payload = sanitizeContratoPayload(await req.json());
    if (!payload.numero_sequencial) {
      const { data: nextNumber, error: sequentialError } = await supabase.rpc(
        "proximo_numero_sequencial_contrato",
        { p_tenant_id: tenantUser.tenant_id },
      );
      if (sequentialError) {
        return new Response(JSON.stringify({ error: sequentialError.message, details: sequentialError.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      payload.numero_sequencial = Number(nextNumber || 0) || null;
    }
    payload.nome_contrato = normalizeContractName(payload);

    // Tenta criar; se nome duplicado, adiciona sufixo incremental
    let data: any = null;
    let lastError: any = null;
    const originalName = payload.nome_contrato;
    const MAX_RETRIES = 5;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        payload.nome_contrato = `${originalName} (${attempt + 1})`;
      }
      const result = await supabase.rpc("create_contrato", {
        p_user_id: user.id,
        p_payload: payload,
      });
      if (!result.error) {
        data = result.data;
        lastError = null;
        break;
      }
      if (result.error.message?.includes("idx_contratos_tenant_nome_unique")) {
        lastError = result.error;
        continue;
      }
      // Outro erro — retorna imediatamente
      return new Response(JSON.stringify({ error: result.error.message, details: result.error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (lastError) {
      return new Response(JSON.stringify({
        error: `Já existe um contrato com o nome "${originalName}". Por favor, escolha outro nome.`,
        details: lastError.message,
      }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (data?.id) {
      const hydratedContrato = await hydrateCreatedContrato(supabase, data.id);
      if (hydratedContrato) {
        data = {
          ...data,
          numero_sequencial: hydratedContrato.numero_sequencial ?? null,
          nome_contrato: hydratedContrato.nome_contrato ?? payload.nome_contrato,
        };
      }

      await createAuditLog({
        supabase,
        tenantId: tenantUser.tenant_id,
        tipoEntidade: "contracts.contratos",
        entidadeId: data.id,
        acao: "create",
        userId: user.id,
        dadosNovos: payload,
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
