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
    if (!body.id) {
      return new Response(JSON.stringify({ error: "ID do caso é obrigatório" }), {
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
      return new Response(JSON.stringify({ error: "Você não tem permissão para editar casos" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { id, ...payload } = body;
    const sanitizedPayload = sanitizeCasoPayload(payload);
    const { data, error } = await supabase.rpc("update_caso", {
      p_user_id: user.id,
      p_caso_id: id,
      p_payload: sanitizedPayload,
    });

    if (error) {
      return new Response(JSON.stringify({ error: error.message, details: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (tenantUser?.tenant_id) {
      await createAuditLog({
        supabase,
        tenantId: tenantUser.tenant_id,
        tipoEntidade: "contracts.casos",
        entidadeId: id,
        acao: "update",
        userId: user.id,
        dadosNovos: { id, ...sanitizedPayload },
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

