import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

function onlyDigits(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\D/g, "");
}
function digitsOrNull(value: unknown): string | null {
  const d = onlyDigits(value);
  return d.length ? d : null;
}

interface AuditLogParams {
  supabase: SupabaseClient;
  tenantId: string;
  tipoEntidade: string;
  entidadeId: string;
  acao: "create" | "update" | "delete";
  userId: string;
  dadosAnteriores?: unknown;
  dadosNovos?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
}

async function createAuditLog(params: AuditLogParams): Promise<string | null> {
  const {
    supabase,
    tenantId,
    tipoEntidade,
    entidadeId,
    acao,
    userId,
    dadosAnteriores = null,
    dadosNovos = null,
    ipAddress = null,
    userAgent = null,
  } = params;
  try {
    const { data: auditLogId, error } = await supabase.rpc("create_audit_log", {
      p_tenant_id: tenantId,
      p_tipo_entidade: tipoEntidade,
      p_entidade_id: entidadeId,
      p_acao: acao,
      p_user_id: userId,
      p_dados_anteriores: dadosAnteriores ? JSON.stringify(dadosAnteriores) : null,
      p_dados_novos: dadosNovos ? JSON.stringify(dadosNovos) : null,
      p_ip_address: ipAddress,
      p_user_agent: userAgent,
    });
    if (error) {
      console.error("Error creating audit log:", error);
      return null;
    }
    return auditLogId;
  } catch (e) {
    console.error("Unexpected error creating audit log:", e);
    return null;
  }
}

function getIpAddress(req: Request): string | null {
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0].trim();
  const realIp = req.headers.get("x-real-ip");
  return realIp ?? null;
}

function getUserAgent(req: Request): string | null {
  return req.headers.get("user-agent");
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

async function syncResponsaveisFinanceiros(
  supabase: ReturnType<typeof createClient>,
  clienteId: string,
  responsaveisFinanceiros: unknown,
) {
  if (!Array.isArray(responsaveisFinanceiros)) return;

  const { error: delErr } = await supabase
    .schema("crm")
    .from("clientes_responsaveis_financeiros")
    .delete()
    .eq("cliente_id", clienteId);

  if (delErr) throw delErr;

  if (responsaveisFinanceiros.length === 0) return;

  const rows = responsaveisFinanceiros.map((rf: Record<string, unknown>) => ({
    cliente_id: clienteId,
    nome: (rf.nome as string | undefined) ?? null,
    email: (rf.email as string | undefined) ?? null,
    whatsapp: digitsOrNull(rf.whatsapp),
  }));

  const { error: insErr } = await supabase
    .schema("crm")
    .from("clientes_responsaveis_financeiros")
    .insert(rows);

  if (insErr) throw insErr;
}

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
    if (!body.id) {
      return new Response(JSON.stringify({ error: "ID é obrigatório" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!body.nome) {
      return new Response(JSON.stringify({ error: "Nome é obrigatório" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const clienteEstrangeiro = body.cliente_estrangeiro ?? false;

    const { data: previous } = await supabase.rpc("get_cliente", {
      p_user_id: user.id,
      p_cliente_id: body.id,
    });

    const { data, error } = await supabase.rpc("update_cliente", {
      p_user_id: user.id,
      p_cliente_id: body.id,
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
      p_resp_fin_nome: body.resp_fin_nome ?? null,
      p_resp_fin_email: body.resp_fin_email ?? null,
      p_resp_fin_whatsapp: digitsOrNull(body.resp_fin_whatsapp),
    });

    if (error) {
      console.error("Error updating cliente:", error);
      return new Response(JSON.stringify({ error: error.message, details: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (body.conta_contabil !== undefined) {
      await supabase
        .schema("crm")
        .from("clientes")
        .update({ conta_contabil: body.conta_contabil ?? null })
        .eq("id", body.id);
    }

    if (Array.isArray(body.responsaveis_financeiros)) {
      try {
        await syncResponsaveisFinanceiros(supabase, body.id, body.responsaveis_financeiros);
      } catch (rfErr) {
        console.error("Erro ao sincronizar responsáveis financeiros:", rfErr);
        return new Response(
          JSON.stringify({
            error: "Cliente atualizado, mas falhou ao salvar responsáveis financeiros",
            details: String(rfErr),
          }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    await createAuditLog({
      supabase,
      tenantId: tenantUser.tenant_id,
      tipoEntidade: "crm.clientes",
      entidadeId: body.id,
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
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
