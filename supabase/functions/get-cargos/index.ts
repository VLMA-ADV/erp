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

    // Verificar permissões do usuário
    const { data: permissionsData, error: permissionsError } = await supabase
      .rpc('get_user_permissions', { p_user_id: user.id });

    if (permissionsError) {
      console.error("Permissions error:", permissionsError);
      return new Response(
        JSON.stringify({ error: "Erro ao verificar permissões" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const requiredPermission = 'config.cargos.read';
    const hasPermission = permissionsData?.some((p: any) => 
      p.permission_key === requiredPermission ||
      p.permission_key === 'config.cargos.*' ||
      p.permission_key === 'config.*' ||
      p.permission_key === '*'
    );

    if (!hasPermission) {
      return new Response(
        JSON.stringify({ error: "Você não tem permissão para realizar esta operação" }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Get cargos usando função RPC
    const { data: cargos, error: cargosError } = await supabase
      .rpc('get_cargos', { p_user_id: user.id });

    if (cargosError) {
      console.error("Error fetching cargos:", cargosError);
      return new Response(
        JSON.stringify({ 
          error: cargosError.message || "Error fetching cargos",
          details: cargosError.message 
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    return new Response(
      JSON.stringify({ data: cargos || [] }),
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
