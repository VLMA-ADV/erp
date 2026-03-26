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
      console.error("Token verification error:", userError);
      return new Response(
        JSON.stringify({ error: "Invalid token", details: userError?.message }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log("User verified:", user.id);

    // Get user's tenant - usar função RPC
    const { data: tenantUserData, error: tenantError } = await supabase
      .rpc('get_user_tenant', { p_user_id: user.id });
    
    const tenantUser = tenantUserData && tenantUserData.length > 0 
      ? { tenant_id: tenantUserData[0].tenant_id } 
      : null;

    if (tenantError) {
      console.error("Tenant error:", tenantError);
      console.error("User ID:", user.id);
      return new Response(
        JSON.stringify({ 
          error: "User not associated with tenant", 
          details: tenantError.message,
          user_id: user.id 
        }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!tenantUser) {
      console.error("No tenant found for user:", user.id);
      return new Response(
        JSON.stringify({ 
          error: "User not associated with tenant",
          user_id: user.id 
        }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log("Tenant found:", tenantUser.tenant_id);

    // Get query parameters
    const url = new URL(req.url);
    const search = url.searchParams.get("search") || "";
    const page = parseInt(url.searchParams.get("page") || "1");
    const limit = parseInt(url.searchParams.get("limit") || "10");

    // Buscar total real de registros para paginação correta
    let totalCount = 0;
    try {
      let countQuery = supabase
        .schema('people')
        .from('colaboradores')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantUser.tenant_id);

      if (search) {
        countQuery = countQuery.ilike('nome', `%${search}%`);
      }

      const { count } = await countQuery;
      totalCount = count ?? 0;
    } catch (countError) {
      console.error("Count query error:", countError);
    }

    // Build query - usar função RPC
    const { data, error: queryError } = await supabase
      .rpc('list_colaboradores', {
        p_tenant_id: tenantUser.tenant_id,
        p_search: search || null,
        p_page: page,
        p_limit: limit
      });

    // Transformar dados para o formato esperado
    const transformedData = data?.map((item: any) => ({
      id: item.id,
      nome: item.nome,
      email: item.email,
      whatsapp: item.whatsapp,
      ativo: item.ativo,
      cargo_id: item.cargo_id,
      cargo: item.cargo_nome ? { nome: item.cargo_nome } : null
    })) || [];

    if (queryError) {
      console.error("Query error:", queryError);
      return new Response(
        JSON.stringify({ error: queryError.message }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Usar total real se a query de count funcionou, senão estimar pelo tamanho da página
    const total = totalCount > 0 ? totalCount : transformedData.length;

    console.log("Returning", transformedData?.length || 0, "colaboradores (total:", total, ")");

    return new Response(
      JSON.stringify({
        data: transformedData,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
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
