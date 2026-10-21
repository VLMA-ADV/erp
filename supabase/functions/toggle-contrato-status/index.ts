import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { normalizeContratoStatusForToggle } from "../_shared/contrato-status.ts";
import { createAuditLog, getIpAddress, getUserAgent } from "../_shared/audit-log.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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

    const body = await req.json();
    // Ativação em massa (questionário out/2026): a lista manda `ids`. Um id só
    // continua chegando em `id`, como sempre.
    const ids: string[] = Array.isArray(body.ids)
      ? body.ids.filter((x: unknown): x is string => typeof x === "string" && x.length > 0)
      : [];
    if ((!body.id && ids.length === 0) || !body.status) {
      return new Response(JSON.stringify({ error: "ID e status são obrigatórios" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const requestedStatus = normalizeContratoStatusForToggle(typeof body.status === "string" ? body.status : undefined) ??
      body.status;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: tenantUserData } = await supabase.rpc("get_user_tenant", { p_user_id: user.id });
    const tenantUser = tenantUserData?.[0];

    const { data: permissionsData } = await supabase.rpc("get_user_permissions", { p_user_id: user.id });
    const keys: string[] = (permissionsData ?? []).map((p: any) => p.permission_key);
    const hasWrite = keys.some((k) =>
      k === "contracts.contratos.write" ||
      k === "contracts.contratos.*" ||
      k === "contracts.*" ||
      k === "*"
    );
    // "Qualquer pessoa pode ativar" (cliente, out/2026): quem tem acesso a
    // Contratos ativa o que está em validação. Encerrar, reativar encerrado e
    // os demais movimentos seguem exigindo escrita.
    const hasRead = hasWrite || keys.includes("contracts.contratos.read");

    const writeAudit = async (contratoId: string, status: string) => {
      if (!tenantUser?.tenant_id) return;
      await createAuditLog({
        supabase,
        tenantId: tenantUser.tenant_id,
        tipoEntidade: "contracts.contratos",
        entidadeId: contratoId,
        acao: "update",
        userId: user.id,
        dadosNovos: { status },
        ipAddress: getIpAddress(req),
        userAgent: getUserAgent(req),
      });
    };

    // Em validação -> ativo: ativar_contratos (mesmo UPDATE de
    // toggle_contrato_status, só para quem está em validação; checa a
    // permissão de leitura no banco também).
    if (requestedStatus === "ativo" && hasRead) {
      const alvo = ids.length > 0 ? ids : [body.id as string];
      const { data: ativacao, error: ativacaoError } = await supabase.rpc("ativar_contratos", {
        p_user_id: user.id,
        p_contrato_ids: alvo,
      });
      if (ativacaoError) {
        return new Response(JSON.stringify({ error: ativacaoError.message, details: ativacaoError.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const ativados: string[] = ativacao?.ativados ?? [];
      const ignorados: string[] = ativacao?.ignorados ?? [];
      for (const contratoId of ativados) await writeAudit(contratoId, "ativo");

      if (ids.length > 0) {
        return new Response(JSON.stringify({ data: { ativados, ignorados } }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (ativados.length > 0) {
        return new Response(JSON.stringify({ data: { id: body.id, status: "ativo" } }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // Não estava em validação (rascunho, encerrado): cai no caminho de sempre,
      // que exige escrita.
    }

    if (ids.length > 0) {
      return new Response(JSON.stringify({ error: "Em lote, só é possível ativar contratos em validação" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!hasWrite) {
      return new Response(JSON.stringify({ error: "Você não tem permissão para alterar status do contrato" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data, error } = await supabase.rpc("toggle_contrato_status", {
      p_user_id: user.id,
      p_contrato_id: body.id,
      p_status: requestedStatus,
    });

    if (error) {
      return new Response(JSON.stringify({ error: error.message, details: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await writeAudit(body.id, requestedStatus);

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
