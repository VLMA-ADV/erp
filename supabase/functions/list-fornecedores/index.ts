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
      return new Response(JSON.stringify({ error: "Missing authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);

    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get tenant
    const { data: tenantUserData, error: tenantError } = await supabase
      .rpc("get_user_tenant", { p_user_id: user.id });

    const tenantUser = tenantUserData && tenantUserData.length > 0
      ? { tenant_id: tenantUserData[0].tenant_id }
      : null;

    if (tenantError || !tenantUser) {
      return new Response(JSON.stringify({ error: "User not associated with tenant" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = new URL(req.url);
    const search = url.searchParams.get("search") || "";
    const page = parseInt(url.searchParams.get("page") || "1", 10);
    // sem 'limit' na query string → retornar todos (compatível com PrestadoresList que não pagina)
    const limitParam = url.searchParams.get("limit");
    const limit = limitParam ? parseInt(limitParam, 10) : 1000;
    const apenasAtivos = url.searchParams.get("ativo") === "true";

    const offset = (page - 1) * limit;

    // Count query
    let countQuery = supabase
      .schema("operations")
      .from("fornecedores")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantUser.tenant_id);

    if (search) {
      countQuery = countQuery.ilike("nome_fornecedor", `%${search}%`);
    }
    if (apenasAtivos) {
      countQuery = countQuery.eq("ativo", true);
    }

    const { count } = await countQuery;
    const total = count ?? 0;

    // Data query
    let dataQuery = supabase
      .schema("operations")
      .from("fornecedores")
      .select("id, nome_fornecedor, cpf_cnpj, tipo_documento, conta_contabil, servico_recorrente, valor_recorrente, ativo, created_at")
      .eq("tenant_id", tenantUser.tenant_id)
      .order("nome_fornecedor", { ascending: true })
      .range(offset, offset + limit - 1);

    if (search) {
      dataQuery = dataQuery.ilike("nome_fornecedor", `%${search}%`);
    }
    if (apenasAtivos) {
      dataQuery = dataQuery.eq("ativo", true);
    }

    const { data: fornecedores, error: listError } = await dataQuery;

    if (listError) {
      console.error("List error:", listError);
      return new Response(JSON.stringify({ error: listError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({
        data: fornecedores ?? [],
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
