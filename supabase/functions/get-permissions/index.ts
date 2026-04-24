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

    // Get permissions usando função RPC
    const { data: permissions, error: permissionsError } = await supabase
      .rpc('get_permissions_by_category', { p_user_id: user.id });

    if (permissionsError) {
      console.error("Error fetching permissions:", permissionsError);
      return new Response(
        JSON.stringify({ 
          error: permissionsError.message || "Error fetching permissions",
          details: permissionsError.message 
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Agrupar por categoria
    const grouped: Record<string, Array<{ id: string; chave: string; descricao: string }>> = {};
    
    if (permissions && permissions.length > 0) {
      permissions.forEach((perm: any) => {
        const categoria = perm.categoria || 'outros';
        if (!grouped[categoria]) {
          grouped[categoria] = [];
        }
        grouped[categoria].push({
          id: perm.permission_id,
          chave: perm.chave,
          descricao: perm.descricao || perm.chave,
        });
      });
    }

    return new Response(
      JSON.stringify({ data: grouped }),
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
