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
    const { id, ...updateFields } = body;

    if (!id) {
      return new Response(JSON.stringify({ error: "Missing id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify ownership before update
    const { data: existing } = await supabase
      .schema("operations")
      .from("fornecedores")
      .select("id, tenant_id")
      .eq("id", id)
      .eq("tenant_id", tenantUser.tenant_id)
      .single();

    if (!existing) {
      return new Response(JSON.stringify({ error: "Fornecedor não encontrado" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const allowedFields = [
      "nome_fornecedor", "cpf_cnpj", "tipo_documento", "conta_contabil",
      "servico_recorrente", "valor_recorrente", "categoria_prestador_parceiro_id",
      "cep", "rua", "numero", "complemento", "cidade", "estado",
      "resp_nome", "resp_email", "resp_cpf", "resp_telefone", "resp_whatsapp",
      "resp_cep", "resp_rua", "resp_numero", "resp_complemento", "resp_cidade", "resp_estado",
      "banco", "conta_com_digito", "agencia", "chave_pix",
    ];

    const fieldsToUpdate: Record<string, any> = {};
    for (const field of allowedFields) {
      if (Object.prototype.hasOwnProperty.call(updateFields, field)) {
        fieldsToUpdate[field] = updateFields[field] === "" ? null : updateFields[field];
      }
    }

    if (Object.keys(fieldsToUpdate).length === 0) {
      return new Response(JSON.stringify({ error: "Nenhum campo válido para atualizar" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: updated, error: updateError } = await supabase
      .schema("operations")
      .from("fornecedores")
      .update(fieldsToUpdate)
      .eq("id", id)
      .eq("tenant_id", tenantUser.tenant_id)
      .select("id")
      .single();

    if (updateError || !updated) {
      console.error("Update error:", updateError);
      return new Response(
        JSON.stringify({ error: updateError?.message || "Erro ao atualizar fornecedor" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Audit log (non-blocking)
    const ipAddress = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
    const userAgent = req.headers.get("user-agent") || null;
    supabase.rpc("create_audit_log", {
      p_tenant_id: tenantUser.tenant_id,
      p_tipo_entidade: "operations.fornecedores",
      p_entidade_id: id,
      p_acao: "update",
      p_user_id: user.id,
      p_dados_anteriores: existing,
      p_dados_novos: fieldsToUpdate,
      p_ip_address: ipAddress,
      p_user_agent: userAgent,
    }).catch((e: any) => console.error("Audit log error:", e));

    return new Response(
      JSON.stringify({ id, message: "Fornecedor atualizado com sucesso" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
