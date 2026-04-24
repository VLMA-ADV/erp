import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { createAuditLog, getIpAddress, getUserAgent } from "../_shared/audit-log.ts";
import { digitsOrNull } from "../_shared/normalize.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

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

    const { data: tenantUserData } = await supabase.rpc("get_user_tenant", { p_user_id: user.id });
    const tenantUser = tenantUserData && tenantUserData.length > 0
      ? { tenant_id: tenantUserData[0].tenant_id }
      : null;
    if (!tenantUser) {
      return new Response(JSON.stringify({ error: "User not associated with tenant" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: permissionsData } = await supabase.rpc("get_user_permissions", { p_user_id: user.id });
    const requiredPermission = "people.parceiros.write";
    const hasPermission = permissionsData?.some((p: any) =>
      p.permission_key === requiredPermission ||
      p.permission_key === "people.parceiros.*" ||
      p.permission_key === "people.*" ||
      p.permission_key === "*"
    );
    if (!hasPermission) {
      return new Response(JSON.stringify({ error: "Você não tem permissão para realizar esta operação" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { id, nome_escritorio } = body;
    if (!id) {
      return new Response(JSON.stringify({ error: "ID é obrigatório" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!nome_escritorio) {
      return new Response(JSON.stringify({ error: "Nome do escritório é obrigatório" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: previous } = await supabase.rpc("get_parceiro", {
      p_user_id: user.id,
      p_parceiro_id: id,
    });

    const { data, error } = await supabase.rpc("update_parceiro", {
      p_user_id: user.id,
      p_parceiro_id: id,
      p_nome_escritorio: nome_escritorio,
      p_cnpj: digitsOrNull(body.cnpj),
      p_rua: body.rua ?? null,
      p_numero: body.numero ?? null,
      p_complemento: body.complemento ?? null,
      p_cidade: body.cidade ?? null,
      p_estado: body.estado ?? null,
      p_cep: digitsOrNull(body.cep),
      p_adv_nome: body.adv_nome ?? null,
      p_adv_email: body.adv_email ?? null,
      p_adv_oab: body.adv_oab ?? null,
      p_adv_cpf: digitsOrNull(body.adv_cpf),
      p_adv_whatsapp: digitsOrNull(body.adv_whatsapp),
      p_fin_nome: body.fin_nome ?? null,
      p_fin_email: body.fin_email ?? null,
      p_fin_whatsapp: digitsOrNull(body.fin_whatsapp),
      p_banco: body.banco ?? null,
      p_conta_com_digito: body.conta_com_digito ?? null,
      p_agencia: body.agencia ?? null,
      p_chave_pix: body.chave_pix ?? null,
      p_categoria_prestador_parceiro_id: body.categoria_prestador_parceiro_id ?? null,
    });

    if (error) {
      console.error("Error updating parceiro:", error);
      return new Response(JSON.stringify({ error: error.message, details: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (body.conta_contabil !== undefined) {
      await supabase
        .schema("operations")
        .from("parceiros")
        .update({ conta_contabil: body.conta_contabil ?? null })
        .eq("id", id);
    }

    const parceiroId = data?.parceiro?.id ?? id;
    await createAuditLog({
      supabase,
      tenantId: tenantUser.tenant_id,
      tipoEntidade: "operations.parceiros",
      entidadeId: parceiroId,
      acao: "update",
      userId: user.id,
      dadosAnteriores: previous,
      dadosNovos: data,
      ipAddress: getIpAddress(req),
      userAgent: getUserAgent(req),
    });

    return new Response(JSON.stringify({ data }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
