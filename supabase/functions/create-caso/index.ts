import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { createAuditLog, getIpAddress, getUserAgent } from "../_shared/audit-log.ts";
import { syncCasoPossuiFlags } from "../_shared/caso-flags-sync.ts";

// RF-081: polo é obrigatório quando natureza_caso === "contencioso"; caso contrário deve ser ignorado.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function sanitizeRuleConfig(ruleConfig: any) {
  if (!ruleConfig || typeof ruleConfig !== "object" || Array.isArray(ruleConfig)) return ruleConfig;
  const { numero_processos: _ignored, ...rest } = ruleConfig;
  return rest;
}

function extractDayFromDate(value: unknown): number | null {
  if (typeof value !== "string" || !value) return null;
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return date.getUTCDate();
}

function normalizeDiaInicio(target: any, context: string): string | null {
  if (!target || typeof target !== "object" || Array.isArray(target)) return null;

  const rawDia = target.dia_inicio_faturamento;
  if (rawDia !== undefined && rawDia !== null && rawDia !== "") {
    const day = Number(rawDia);
    if (!Number.isInteger(day) || day < 1 || day > 31) {
      return `${context}: dia_inicio_faturamento deve ser inteiro entre 1 e 31`;
    }
    target.dia_inicio_faturamento = day;
    return null;
  }

  const dayFromLegacyDate = extractDayFromDate(target.data_inicio_faturamento);
  if (dayFromLegacyDate !== null) target.dia_inicio_faturamento = dayFromLegacyDate;
  return null;
}

function normalizeDiaInicioPayload(payload: any) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { payload };
  const next = { ...payload };

  const rootError = normalizeDiaInicio(next, "caso");
  if (rootError) return { payload: next, error: rootError };

  if (Array.isArray(next.regras_financeiras)) {
    next.regras_financeiras = next.regras_financeiras.map((rule: any, index: number) => {
      if (!rule || typeof rule !== "object" || Array.isArray(rule)) return rule;
      const normalizedRule = { ...rule };
      const ruleError = normalizeDiaInicio(normalizedRule, `regras_financeiras[${index}]`);
      if (ruleError) throw new RangeError(ruleError);
      return normalizedRule;
    });
  }

  if (
    next.regra_cobranca_config &&
    typeof next.regra_cobranca_config === "object" &&
    !Array.isArray(next.regra_cobranca_config) &&
    Array.isArray(next.regra_cobranca_config.regras_cobranca)
  ) {
    next.regra_cobranca_config = {
      ...next.regra_cobranca_config,
      regras_cobranca: next.regra_cobranca_config.regras_cobranca.map((rule: any, index: number) => {
        if (!rule || typeof rule !== "object" || Array.isArray(rule)) return rule;
        const normalizedRule = { ...rule };
        const ruleError = normalizeDiaInicio(normalizedRule, `regra_cobranca_config.regras_cobranca[${index}]`);
        if (ruleError) throw new RangeError(ruleError);
        return normalizedRule;
      }),
    };
  }

  return { payload: next };
}

function readNestedString(value: any, path: string[]) {
  let current = value;
  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return "";
    current = current[key];
  }
  return typeof current === "string" ? current : "";
}

function getEffectiveNatureza(payload: any) {
  const firstRule = Array.isArray(payload?.regras_financeiras) ? payload.regras_financeiras[0] : null;
  const firstConfigRule = Array.isArray(payload?.regra_cobranca_config?.regras_cobranca)
    ? payload.regra_cobranca_config.regras_cobranca[0]
    : null;

  return [
    payload?.natureza_caso,
    readNestedString(payload, ["regra_cobranca_config", "natureza_caso"]),
    firstRule?.natureza_caso,
    readNestedString(firstRule, ["regra_cobranca_config", "natureza_caso"]),
    firstConfigRule?.natureza_caso,
    readNestedString(firstConfigRule, ["regra_cobranca_config", "natureza_caso"]),
  ]
    .map((value) => String(value || "").trim().toLowerCase())
    .find(Boolean) || "";
}

function normalizePoloPayload(payload: any) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { payload };
  const next = { ...payload };
  const natureza = getEffectiveNatureza(next);
  const polo = String(next.polo || "").trim().toLowerCase();

  if (natureza === "contencioso") {
    if (!polo) return { payload: next, error: "Polo é obrigatório quando natureza_caso é contencioso" };
    if (polo !== "ativo" && polo !== "passivo") return { payload: next, error: "Polo inválido (use ativo ou passivo)" };
    next.polo = polo;
    return { payload: next };
  }

  next.polo = null;
  return { payload: next };
}

function sanitizeCasoPayload(payload: any) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  const next = { ...payload };
  next.regra_cobranca_config = sanitizeRuleConfig(next.regra_cobranca_config);
  if (Array.isArray(next.regras_financeiras)) {
    next.regras_financeiras = next.regras_financeiras.map((rule: any) => {
      if (!rule || typeof rule !== "object" || Array.isArray(rule)) return rule;
      const sanitizedRule = { ...rule };
      sanitizedRule.regra_cobranca_config = sanitizeRuleConfig(sanitizedRule.regra_cobranca_config);
      return sanitizedRule;
    });
  }
  return next;
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

    const body = await req.json();
    if (!body.contrato_id) {
      return new Response(JSON.stringify({ error: "ID do contrato é obrigatório" }), {
        status: 400,
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

    const { data: permissionsData } = await supabase.rpc("get_user_permissions", { p_user_id: user.id });
    const hasPermission = permissionsData?.some((p: any) =>
      p.permission_key === "contracts.casos.write" ||
      p.permission_key === "contracts.contratos.write" ||
      p.permission_key === "contracts.*" ||
      p.permission_key === "*"
    );
    if (!hasPermission) {
      return new Response(JSON.stringify({ error: "Você não tem permissão para criar casos" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { contrato_id, ...rawPayload } = body;
    let normalizedPayload;
    try {
      const normalized = normalizeDiaInicioPayload(rawPayload);
      if (normalized.error) {
        return new Response(JSON.stringify({ error: normalized.error }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const poloNormalized = normalizePoloPayload(normalized.payload);
      if (poloNormalized.error) {
        return new Response(JSON.stringify({ error: poloNormalized.error }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      normalizedPayload = poloNormalized.payload;
    } catch (error) {
      if (error instanceof RangeError) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw error;
    }
    const sanitizedPayload = sanitizeCasoPayload(normalizedPayload);
    const { data, error } = await supabase.rpc("create_caso", {
      p_user_id: user.id,
      p_contrato_id: contrato_id,
      p_payload: sanitizedPayload,
    });

    if (error) {
      return new Response(JSON.stringify({ error: error.message, details: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const casoId = data?.id ? String(data.id) : null;
    if (casoId && tenantUser?.tenant_id) {
      const flagErr = await syncCasoPossuiFlags(supabase, tenantUser.tenant_id, casoId, body);
      if (flagErr) {
        return new Response(JSON.stringify({ error: flagErr.message, details: flagErr.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    if (tenantUser?.tenant_id && casoId) {
      await createAuditLog({
        supabase,
        tenantId: tenantUser.tenant_id,
        tipoEntidade: "contracts.casos",
        entidadeId: casoId,
        acao: "create",
        userId: user.id,
        dadosNovos: { contrato_id, ...sanitizedPayload },
        ipAddress: getIpAddress(req),
        userAgent: getUserAgent(req),
      });
    }

    return new Response(JSON.stringify({ data }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
