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
    const requiredPermission = "crm.clientes.write";
    const hasPermission = permissionsData?.some((p: { permission_key?: string }) =>
      p.permission_key === requiredPermission ||
      p.permission_key === "crm.clientes.*" ||
      p.permission_key === "crm.*" ||
      p.permission_key === "*"
    );
    if (!hasPermission) {
      return new Response(JSON.stringify({ error: "Você não tem permissão para realizar esta operação" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const body = await req.json();
    if (!body.nome) {
      return new Response(JSON.stringify({ error: "Nome é obrigatório" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const clienteEstrangeiro = body.cliente_estrangeiro ?? false;

    const responsaveisFinanceiros = Array.isArray(body.responsaveis_financeiros)
      ? body.responsaveis_financeiros
          .filter((rf: { nome?: unknown }) =>
            rf && typeof rf.nome === "string" && rf.nome.trim().length > 0,
          )
          .map((rf: { nome: string; email?: unknown; whatsapp?: unknown }) => ({
            nome: rf.nome.trim(),
            email: rf.email ?? null,
            whatsapp: digitsOrNull(rf.whatsapp),
          }))
      : null;

    const { data, error } = await supabase.rpc("create_cliente", {
      p_user_id: user.id,
      p_nome: body.nome,
      p_cliente_estrangeiro: clienteEstrangeiro,
      p_cnpj: clienteEstrangeiro ? null : digitsOrNull(body.cnpj),
      p_tipo: body.tipo ?? null,
      p_rua: body.rua ?? null,
      p_numero: body.numero ?? null,
      p_complemento: body.complemento ?? null,
      p_cidade: body.cidade ?? null,
      p_estado: body.estado ?? null,
      p_cep: digitsOrNull(body.cep),
      p_regime_fiscal: body.regime_fiscal ?? null,
      p_grupo_economico_id: body.grupo_economico_id ?? null,
      p_observacoes: body.observacoes ?? null,
      p_segmento_ids: body.segmento_ids ?? null,
      p_resp_int_nome: body.resp_int_nome ?? null,
      p_resp_int_email: body.resp_int_email ?? null,
      p_resp_int_whatsapp: digitsOrNull(body.resp_int_whatsapp),
      p_resp_int_data_nascimento: body.resp_int_data_nascimento ?? null,
      p_responsaveis_financeiros: responsaveisFinanceiros,
    });
    if (error) {
      console.error("Error creating cliente:", error);
      return new Response(JSON.stringify({ error: error.message, details: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const clienteId = data?.cliente?.id as string | undefined;
    if (clienteId && body.conta_contabil !== undefined) {
      await supabase
        .schema("crm")
        .from("clientes")
        .update({ conta_contabil: body.conta_contabil ?? null })
        .eq("id", clienteId);
    }
    if (clienteId) {
      await createAuditLog({
        supabase,
        tenantId: tenantUser.tenant_id,
        tipoEntidade: "crm.clientes",
        entidadeId: clienteId,
        acao: "create",
        userId: user.id,
        dadosNovos: data,
        ipAddress: getIpAddress(req),
        userAgent: getUserAgent(req),
      });
    }
    return new Response(JSON.stringify({ data }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
