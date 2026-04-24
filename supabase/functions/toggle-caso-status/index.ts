import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { createAuditLog, getIpAddress, getUserAgent } from "../_shared/audit-log.ts";

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

    const body = await req.json();
    if (!body.id || !body.status) {
      return new Response(JSON.stringify({ error: "ID e status são obrigatórios" }), {
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
      return new Response(JSON.stringify({ error: "Você não tem permissão para alterar status do caso" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data, error } = await supabase.rpc("toggle_caso_status", {
      p_user_id: user.id,
      p_caso_id: body.id,
      p_status: body.status,
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
        entidadeId: body.id,
        acao: "update",
        userId: user.id,
        dadosNovos: { status: body.status },
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

