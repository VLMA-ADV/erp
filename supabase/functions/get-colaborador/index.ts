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

    // Get colaborador ID from URL
    const url = new URL(req.url);
    const colaboradorId = url.searchParams.get("id");

    if (!colaboradorId) {
      return new Response(
        JSON.stringify({ error: "Missing colaborador id" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Use optimized RPC function to get all colaborador data in one query
    const { data: colaboradorData, error: rpcError } = await supabase
      .rpc('get_colaborador_complete', { 
        p_user_id: user.id,
        p_colaborador_id: colaboradorId 
      });

    if (rpcError) {
      console.error("RPC Error fetching colaborador:", rpcError);
      return new Response(
        JSON.stringify({ 
          error: "Error fetching colaborador", 
          details: rpcError.message 
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!colaboradorData) {
      return new Response(
        JSON.stringify({ error: "Colaborador not found" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // colaboradorData já vem completo com todos os dados (roles, permissions, beneficios)
    // Apenas garantir que arrays vazios sejam retornados como arrays, não null
    const colaborador = {
      ...colaboradorData,
      colaboradores_beneficios: colaboradorData.colaboradores_beneficios || [],
      user_roles: colaboradorData.user_roles || [],
      permissions: colaboradorData.permissions || [],
    };

    return new Response(
      JSON.stringify({ data: colaborador }),
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
