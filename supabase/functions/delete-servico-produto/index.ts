import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { createAuditLog, getIpAddress, getUserAgent } from "../_shared/audit-log.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type PermissionRow = {
  permission_key?: string;
};

type CountTarget = {
  schema: "contracts" | "crm";
  table: "casos" | "contratos" | "pipeline_cards";
  column: "produto_id";
};

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const jsonResponse = (body: Record<string, unknown>, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const hasWritePermission = (permissions: PermissionRow[] | null | undefined) =>
  (permissions ?? []).some((permission) => {
    const key = permission.permission_key;
    return key === "config.produtos.write" || key === "config.produtos.*" || key === "config.*" || key === "*";
  });

const countRows = async (
  supabase: ReturnType<typeof createClient>,
  target: CountTarget,
  id: string,
  tenantId: string,
) => {
  const { count, error } = await supabase
    .schema(target.schema)
    .from(target.table)
    .select("id", { count: "exact", head: true })
    .eq(target.column, id)
    .eq("tenant_id", tenantId);

  if (error) throw error;
  return count ?? 0;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ error: "Missing authorization header" }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const id = typeof body.id === "string" ? body.id.trim() : "";
    if (!uuidRegex.test(id)) {
      return jsonResponse({ error: "ID do produto é obrigatório" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(token);

    if (userError || !user) {
      return jsonResponse({ error: "Invalid token" }, 401);
    }

    const { data: tenantUserData } = await supabase.rpc("get_user_tenant", {
      p_user_id: user.id,
    });
    const tenantId = typeof tenantUserData?.[0]?.tenant_id === "string" ? tenantUserData[0].tenant_id : "";

    if (!tenantId) {
      return jsonResponse({ error: "User not associated with tenant" }, 403);
    }

    const { data: permissionsData, error: permissionsError } = await supabase.rpc("get_user_permissions", {
      p_user_id: user.id,
    });

    if (permissionsError) {
      return jsonResponse({ error: "Erro ao verificar permissões" }, 500);
    }

    if (!hasWritePermission(permissionsData as PermissionRow[] | null | undefined)) {
      return jsonResponse({ error: "Você não tem permissão para excluir produto" }, 403);
    }

    const [casos, contratos, pipelineCards] = await Promise.all([
      countRows(supabase, { schema: "contracts", table: "casos", column: "produto_id" }, id, tenantId),
      countRows(supabase, { schema: "contracts", table: "contratos", column: "produto_id" }, id, tenantId),
      countRows(supabase, { schema: "crm", table: "pipeline_cards", column: "produto_id" }, id, tenantId),
    ]);

    if (casos > 0 || contratos > 0 || pipelineCards > 0) {
      return jsonResponse(
        {
          error: `Não é possível excluir: usado em ${casos} caso(s), ${contratos} contrato(s), ${pipelineCards} card(s) do pipeline`,
        },
        409,
      );
    }

    const { data: deletedRows, error: deleteError } = await supabase
      .schema("contracts")
      .from("produtos")
      .delete()
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .select("id, nome");

    if (deleteError) {
      return jsonResponse({ error: deleteError.message }, 500);
    }

    if (!deletedRows?.length) {
      return jsonResponse({ error: "Produto não encontrado" }, 404);
    }

    await createAuditLog({
      supabase,
      tenantId,
      tipoEntidade: "contracts.produtos",
      entidadeId: id,
      acao: "delete",
      userId: user.id,
      dadosNovos: { id, nome: deletedRows[0].nome, deleted: true },
      ipAddress: getIpAddress(req),
      userAgent: getUserAgent(req),
    });

    return jsonResponse({ ok: true }, 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonResponse({ error: message }, 500);
  }
});
