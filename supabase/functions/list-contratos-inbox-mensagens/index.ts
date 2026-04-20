// Deploy: manter verify_jwt=false no dashboard/CLI (mesmo padrão do projeto).
// O gateway com verify_jwt=true rejeita sessões JWT ES256 do GoTrue;
// a validação fica em auth.getUser() dentro do handler.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface PermissionRow {
  permission_key: string;
}

interface TenantRow {
  tenant_id: string;
}

interface MensagemRow {
  id: string;
  solicitacao_id: string;
  contrato_id: string | null;
  autor_id: string;
  mensagem: string;
  created_at: string;
  tenant_id: string;
}

interface SolicitacaoRow {
  id: string;
  nome: string | null;
  descricao: string | null;
  contrato_id: string | null;
  tenant_id: string;
}

interface ContratoRow {
  id: string;
  numero_sequencial: number | null;
  nome_contrato: string | null;
  tenant_id: string;
}

interface AutorRow {
  id: string;
  nome: string | null;
}

function jsonRes(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function hasContratosReadPermission(rows: PermissionRow[] | null): boolean {
  return (rows ?? []).some((p) =>
    p.permission_key === "contracts.contratos.read" ||
    p.permission_key === "contracts.contratos.*" ||
    p.permission_key === "contracts.*" ||
    p.permission_key === "*"
  );
}

function clampLimit(value: string | null): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 10;
  return Math.min(parsed, 50);
}

function parseSince(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function preview(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 120 ? `${normalized.slice(0, 117)}...` : normalized;
}

function contratoCodigo(contrato: ContratoRow | undefined): string | null {
  if (!contrato) return null;
  if (typeof contrato.numero_sequencial === "number") {
    return String(contrato.numero_sequencial);
  }
  return contrato.nome_contrato ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET" && req.method !== "POST") {
    return jsonRes({ error: "Method not allowed" }, 405);
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonRes({ error: "Missing authorization header" }, 401);
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
      return jsonRes({ error: "Invalid token" }, 401);
    }

    const { data: permissionsData, error: permissionsError } = await supabase.rpc(
      "get_user_permissions",
      { p_user_id: user.id },
    );

    if (permissionsError) {
      return jsonRes({ error: "Erro ao verificar permissões" }, 500);
    }

    if (!hasContratosReadPermission((permissionsData ?? []) as PermissionRow[])) {
      return jsonRes({ error: "Você não tem permissão para visualizar contratos" }, 403);
    }

    const { data: tenantData, error: tenantError } = await supabase.rpc(
      "get_user_tenant",
      { p_user_id: user.id },
    );

    if (tenantError) {
      return jsonRes({ error: "Erro ao resolver tenant" }, 500);
    }

    const tenantRows = (Array.isArray(tenantData) ? tenantData : [tenantData]).filter(Boolean) as TenantRow[];
    const tenantId = tenantRows[0]?.tenant_id;

    if (!tenantId) {
      return jsonRes({ error: "Tenant não encontrado para o usuário" }, 403);
    }

    const url = new URL(req.url);
    const limit = clampLimit(url.searchParams.get("limit"));
    const since = parseSince(url.searchParams.get("since"));

    let countQuery = supabase
      .schema("contracts")
      .from("solicitacao_mensagens")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId);

    let mensagensQuery = supabase
      .schema("contracts")
      .from("solicitacao_mensagens")
      .select("id, solicitacao_id, contrato_id, autor_id, mensagem, created_at, tenant_id")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (since) {
      countQuery = countQuery.gte("created_at", since);
      mensagensQuery = mensagensQuery.gte("created_at", since);
    }

    const [{ data: mensagensData, error: mensagensError }, { count, error: countError }] =
      await Promise.all([mensagensQuery, countQuery]);

    if (mensagensError || countError) {
      return jsonRes(
        { error: mensagensError?.message ?? countError?.message ?? "Erro ao buscar mensagens" },
        500,
      );
    }

    const mensagens = (mensagensData ?? []) as MensagemRow[];
    const solicitacaoIds = [...new Set(mensagens.map((m) => m.solicitacao_id).filter(Boolean))];
    const autorIds = [...new Set(mensagens.map((m) => m.autor_id).filter(Boolean))];

    let solicitacoesMap = new Map<string, SolicitacaoRow>();
    if (solicitacaoIds.length > 0) {
      const { data: solicitacoes, error: solicitacoesError } = await supabase
        .schema("contracts")
        .from("solicitacoes_contrato")
        .select("id, nome, descricao, contrato_id, tenant_id")
        .eq("tenant_id", tenantId)
        .in("id", solicitacaoIds);

      if (solicitacoesError) {
        return jsonRes({ error: solicitacoesError.message }, 500);
      }

      solicitacoesMap = new Map(((solicitacoes ?? []) as SolicitacaoRow[]).map((item) => [item.id, item]));
    }

    const contratoIds = [
      ...new Set(
        mensagens
          .map((m) => m.contrato_id ?? solicitacoesMap.get(m.solicitacao_id)?.contrato_id ?? null)
          .filter((id): id is string => typeof id === "string" && id.length > 0),
      ),
    ];

    let contratosMap = new Map<string, ContratoRow>();
    if (contratoIds.length > 0) {
      const { data: contratos, error: contratosError } = await supabase
        .schema("contracts")
        .from("contratos")
        .select("id, numero_sequencial, nome_contrato, tenant_id")
        .eq("tenant_id", tenantId)
        .in("id", contratoIds);

      if (contratosError) {
        return jsonRes({ error: contratosError.message }, 500);
      }

      contratosMap = new Map(((contratos ?? []) as ContratoRow[]).map((item) => [item.id, item]));
    }

    let autoresMap = new Map<string, AutorRow>();
    if (autorIds.length > 0) {
      const { data: autores, error: autoresError } = await supabase
        .schema("people")
        .from("colaboradores")
        .select("id, nome")
        .in("id", autorIds);

      if (autoresError) {
        return jsonRes({ error: autoresError.message }, 500);
      }

      autoresMap = new Map(((autores ?? []) as AutorRow[]).map((item) => [item.id, item]));
    }

    const mensagensResponse = mensagens.map((mensagem) => {
      const solicitacao = solicitacoesMap.get(mensagem.solicitacao_id);
      const resolvedContratoId = mensagem.contrato_id ?? solicitacao?.contrato_id ?? null;
      const contrato = resolvedContratoId ? contratosMap.get(resolvedContratoId) : undefined;
      const autor = autoresMap.get(mensagem.autor_id);

      return {
        id: mensagem.id,
        solicitacao_id: mensagem.solicitacao_id,
        contrato_id: resolvedContratoId,
        contrato_codigo: contratoCodigo(contrato),
        contrato_nome: contrato?.nome_contrato ?? null,
        solicitacao_nome: solicitacao?.nome ?? solicitacao?.descricao ?? null,
        remetente_id: mensagem.autor_id,
        remetente_nome: autor?.nome ?? "Usuário",
        mensagem_preview: preview(mensagem.mensagem),
        created_at: mensagem.created_at,
      };
    });

    console.log(
      JSON.stringify({
        edge: "list-contratos-inbox-mensagens",
        split_queries: ["mensagens", "solicitacoes_contrato", "contratos", "colaboradores"],
        tenant_id: tenantId,
        total: count ?? 0,
        returned: mensagensResponse.length,
      }),
    );

    return jsonRes({ mensagens: mensagensResponse, total: count ?? mensagensResponse.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonRes({ error: message }, 500);
  }
});
