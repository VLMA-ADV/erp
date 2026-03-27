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

    // Check write permission
    const { data: permissionsData } = await supabase
      .rpc("get_user_permissions", { p_user_id: user.id });

    const hasPermission = !permissionsData || permissionsData.length === 0 ||
      permissionsData.some((p: any) =>
        ["operations.fornecedores.write", "operations.fornecedores.*", "operations.*", "*"].includes(p.permission_key)
      );

    if (!hasPermission) {
      return new Response(JSON.stringify({ error: "Insufficient permissions" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const {
      nome_fornecedor,
      cpf_cnpj,
      tipo_documento,
      conta_contabil,
      servico_recorrente,
      valor_recorrente,
      categoria_prestador_parceiro_id,
      cep,
      rua,
      numero,
      complemento,
      cidade,
      estado,
      resp_nome,
      resp_email,
      resp_cpf,
      resp_telefone,
      resp_whatsapp,
      resp_cep,
      resp_rua,
      resp_numero,
      resp_complemento,
      resp_cidade,
      resp_estado,
      banco,
      conta_com_digito,
      agencia,
      chave_pix,
    } = body;

    if (!nome_fornecedor || !cpf_cnpj) {
      return new Response(JSON.stringify({ error: "nome_fornecedor e cpf_cnpj são obrigatórios" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: fornecedor, error: insertError } = await supabase
      .schema("operations")
      .from("fornecedores")
      .insert({
        nome_fornecedor,
        cpf_cnpj,
        tipo_documento: tipo_documento || "cnpj",
        conta_contabil: conta_contabil || null,
        servico_recorrente: servico_recorrente ?? false,
        valor_recorrente: valor_recorrente ?? null,
        categoria_prestador_parceiro_id: categoria_prestador_parceiro_id || null,
        cep: cep || null,
        rua: rua || null,
        numero: numero || null,
        complemento: complemento || null,
        cidade: cidade || null,
        estado: estado || null,
        resp_nome: resp_nome || null,
        resp_email: resp_email || null,
        resp_cpf: resp_cpf || null,
        resp_telefone: resp_telefone || null,
        resp_whatsapp: resp_whatsapp || null,
        resp_cep: resp_cep || null,
        resp_rua: resp_rua || null,
        resp_numero: resp_numero || null,
        resp_complemento: resp_complemento || null,
        resp_cidade: resp_cidade || null,
        resp_estado: resp_estado || null,
        banco: banco || null,
        conta_com_digito: conta_com_digito || null,
        agencia: agencia || null,
        chave_pix: chave_pix || null,
        ativo: true,
        tenant_id: tenantUser.tenant_id,
      })
      .select("id")
      .single();

    if (insertError || !fornecedor) {
      console.error("Insert error:", insertError);
      return new Response(
        JSON.stringify({ error: insertError?.message || "Erro ao criar fornecedor" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Audit log (non-blocking)
    const ipAddress = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
    const userAgent = req.headers.get("user-agent") || null;
    supabase.rpc("create_audit_log", {
      p_tenant_id: tenantUser.tenant_id,
      p_tipo_entidade: "operations.fornecedores",
      p_entidade_id: fornecedor.id,
      p_acao: "create",
      p_user_id: user.id,
      p_dados_anteriores: null,
      p_dados_novos: body,
      p_ip_address: ipAddress,
      p_user_agent: userAgent,
    }).catch((e: any) => console.error("Audit log error:", e));

    return new Response(
      JSON.stringify({ id: fornecedor.id, message: "Fornecedor criado com sucesso" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
