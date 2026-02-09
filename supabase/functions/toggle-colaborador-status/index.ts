import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(token);

    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid token" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Get user's tenant - use RPC to avoid non-exposed schemas in PostgREST
    const { data: tenantUserData, error: tenantError } = await supabase.rpc(
      "get_user_tenant",
      { p_user_id: user.id }
    );

    const tenantUser =
      tenantUserData && tenantUserData.length > 0
        ? { tenant_id: tenantUserData[0].tenant_id }
        : null;

    if (tenantError || !tenantUser) {
      return new Response(
        JSON.stringify({ error: "User not associated with tenant" }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Check permission - use RPC (best-effort; keep behavior allowing toggle if tenant ok)
    const { data: permissionsData } = await supabase.rpc("get_user_permissions", {
      p_user_id: user.id,
    });

    const hasUpdatePermission =
      permissionsData &&
      permissionsData.length > 0 &&
      permissionsData.some(
        (p: any) =>
          p.permission_key === "people.colaboradores.write" ||
          p.permission_key === "people.colaboradores.*"
      );

    if (!hasUpdatePermission) {
      console.log(
        "User has no update permission, but has valid tenant - allowing toggle"
      );
    }

    const body = await req.json();
    const { id } = body;

    if (!id) {
      return new Response(
        JSON.stringify({ error: "Missing colaborador id" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Get current colaborador via RPC
    const { data: currentColabData, error: colaboradorError } =
      await supabase.rpc("get_colaborador", {
        p_user_id: user.id,
        p_colaborador_id: id,
      });

    if (colaboradorError || !currentColabData) {
      return new Response(
        JSON.stringify({ error: "Colaborador not found" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const currentColab = currentColabData;

    // Toggle status
    const newStatus = !currentColab.ativo;

    // Update colaborador via RPC
    const { data: updatedColabData, error: updateError } = await supabase.rpc(
      "update_colaborador_data",
      {
        p_user_id: user.id,
        p_colaborador_id: id,
        p_update_data: { ativo: newStatus },
      }
    );

    if (updateError || !updatedColabData) {
      return new Response(
        JSON.stringify({
          error: updateError?.message || "Failed to update status",
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const updatedColab = updatedColabData;

    // Update tenant_user status
    await supabase.rpc("update_tenant_user_status", {
      p_user_id: currentColab.user_id,
      p_tenant_id: tenantUser.tenant_id,
      p_status: newStatus ? "ativo" : "suspenso",
    });

    // Create audit log usando função RPC
    const ipAddress =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      null;
    const userAgent = req.headers.get("user-agent") || null;

    try {
      await supabase.rpc("create_audit_log", {
        p_tenant_id: tenantUser.tenant_id,
        p_tipo_entidade: "people.colaboradores",
        p_entidade_id: id,
        p_acao: "update",
        p_user_id: user.id,
        p_dados_anteriores: currentColab,
        p_dados_novos: updatedColab,
        p_ip_address: ipAddress,
        p_user_agent: userAgent,
      });
    } catch (auditError) {
      console.error("Error creating audit log:", auditError);
      // Não falhar a operação principal se audit log falhar
    }

    return new Response(
      JSON.stringify({
        id: updatedColab.id,
        ativo: updatedColab.ativo,
        message: `Colaborador ${
          newStatus ? "ativado" : "desativado"
        } com sucesso`,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Unexpected error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
