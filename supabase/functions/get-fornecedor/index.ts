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
    const id = url.searchParams.get("id");

    if (!id) {
      return new Response(JSON.stringify({ error: "Missing id parameter" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: fornecedor, error: fetchError } = await supabase
      .schema("operations")
      .from("fornecedores")
      .select("*")
      .eq("id", id)
      .eq("tenant_id", tenantUser.tenant_id)
      .single();

    if (fetchError || !fornecedor) {
      return new Response(JSON.stringify({ error: "Fornecedor não encontrado" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Shape the response to match the format expected by PrestadorForm
    return new Response(
      JSON.stringify({
        data: {
          fornecedor,
          responsavel_interno: {
            nome: fornecedor.resp_nome,
            email: fornecedor.resp_email,
            cpf: fornecedor.resp_cpf,
            telefone: fornecedor.resp_telefone,
            whatsapp: fornecedor.resp_whatsapp,
            cep: fornecedor.resp_cep,
            rua: fornecedor.resp_rua,
            numero: fornecedor.resp_numero,
            complemento: fornecedor.resp_complemento,
            cidade: fornecedor.resp_cidade,
            estado: fornecedor.resp_estado,
          },
          dados_bancarios: {
            banco: fornecedor.banco,
            conta_com_digito: fornecedor.conta_com_digito,
            agencia: fornecedor.agencia,
            chave_pix: fornecedor.chave_pix,
          },
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
