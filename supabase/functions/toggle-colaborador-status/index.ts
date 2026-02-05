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

    // Get user's tenant
    const { data: tenantUser } = await supabase
      .schema("core")
      .from("tenant_users")
      .select("tenant_id")
      .eq("user_id", user.id)
      .eq("status", "ativo")
      .single();

    if (!tenantUser) {
      return new Response(
        JSON.stringify({ error: "User not associated with tenant" }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Check permission
    const { data: userRoles } = await supabase
      .schema("core")
      .from("user_roles")
      .select("role_id")
      .eq("tenant_id", tenantUser.tenant_id)
      .eq("user_id", user.id);

    if (!userRoles || userRoles.length === 0) {
      return new Response(
        JSON.stringify({ error: "No permissions" }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
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

    // Get current colaborador
    const { data: currentColab } = await supabase
      .schema("people")
      .from("colaboradores")
      .select("*")
      .eq("id", id)
      .eq("tenant_id", tenantUser.tenant_id)
      .single();

    if (!currentColab) {
      return new Response(
        JSON.stringify({ error: "Colaborador not found" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Toggle status
    const newStatus = !currentColab.ativo;

    const { data: updatedColab, error: updateError } = await supabase
      .schema("people")
      .from("colaboradores")
      .update({
        ativo: newStatus,
        updated_by: user.id,
      })
      .eq("id", id)
      .eq("tenant_id", tenantUser.tenant_id)
      .select()
      .single();

    if (updateError || !updatedColab) {
      return new Response(
        JSON.stringify({ error: updateError?.message || "Failed to update status" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Update tenant_user status
    await supabase
      .schema("core")
      .from("tenant_users")
      .update({ status: newStatus ? "ativo" : "suspenso" })
      .eq("user_id", currentColab.user_id)
      .eq("tenant_id", tenantUser.tenant_id);

    // Create audit log usando função RPC
    const ipAddress = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 
                      req.headers.get('x-real-ip') || 
                      null;
    const userAgent = req.headers.get('user-agent') || null;

    try {
      await supabase.rpc('create_audit_log', {
        p_tenant_id: tenantUser.tenant_id,
        p_tipo_entidade: 'people.colaboradores',
        p_entidade_id: id,
        p_acao: 'update',
        p_user_id: user.id,
        p_dados_anteriores: currentColab,
        p_dados_novos: updatedColab,
        p_ip_address: ipAddress,
        p_user_agent: userAgent,
      });
    } catch (auditError) {
      console.error('Error creating audit log:', auditError);
      // Não falhar a operação principal se audit log falhar
    }

    return new Response(
      JSON.stringify({ 
        id: updatedColab.id, 
        ativo: updatedColab.ativo,
        message: `Colaborador ${newStatus ? "ativado" : "desativado"} com sucesso` 
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
