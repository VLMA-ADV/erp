import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"
import { assinarFotos } from "../_shared/fotos.ts"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  // grid de revisão precisa ser sempre fresca (nada de resposta cacheada)
  "Cache-Control": "no-store",
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function pickFirstDefined(...values: unknown[]) {
  for (const value of values) {
    if (value !== null && value !== undefined) return value
  }
  return null
}

function normalizeHistoricoEntry(entry: unknown) {
  const row = toRecord(entry)
  if (!row) return null

  return {
    id: row.id ?? null,
    billing_item_id: row.billing_item_id ?? null,
    role: row.role ?? null,
    author_id: row.author_id ?? null,
    author_name: pickFirstDefined(row.author_name, row.nome, row.nome_completo, "Usuário"),
    horas: row.horas ?? null,
    valor: row.valor ?? null,
    texto: row.texto ?? null,
    tenant_id: row.tenant_id ?? null,
    created_at: row.created_at ?? null,
  }
}

function normalizeRevisaoFaturaItem(item: unknown) {
  const row = toRecord(item)
  if (!row) return item

  const snapshot = toRecord(row.snapshot) ?? {}
  const historico = Array.isArray(row.historico)
    ? row.historico.map((entry) => normalizeHistoricoEntry(entry)).filter(Boolean)
    : []

  return {
    ...row,
    historico,
    data_revisao: pickFirstDefined(row.data_revisao, snapshot.data_revisao),
    data_aprovacao: pickFirstDefined(row.data_aprovacao, snapshot.data_aprovacao),
    responsavel_revisao_id: pickFirstDefined(row.responsavel_revisao_id, snapshot.responsavel_revisao_id),
    responsavel_aprovacao_id: pickFirstDefined(row.responsavel_aprovacao_id, snapshot.responsavel_aprovacao_id),
    responsavel_revisao_nome: pickFirstDefined(row.responsavel_revisao_nome, snapshot.responsavel_revisao_nome),
    responsavel_aprovacao_nome: pickFirstDefined(row.responsavel_aprovacao_nome, snapshot.responsavel_aprovacao_nome),
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })

  try {
    const authHeader = req.headers.get("Authorization")
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } },
    )

    const token = authHeader.replace("Bearer ", "")
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(token)

    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const { data: permissionsData } = await supabase.rpc("get_user_permissions", { p_user_id: user.id })
    const hasPermission = permissionsData?.some(
      (p: any) =>
        p.permission_key === "finance.faturamento.read" ||
        p.permission_key === "finance.faturamento.review" ||
        p.permission_key === "finance.faturamento.approve" ||
        p.permission_key === "finance.faturamento.manage" ||
        p.permission_key === "finance.faturamento.*" ||
        p.permission_key === "finance.*" ||
        p.permission_key === "*",
    )

    if (!hasPermission) {
      return new Response(JSON.stringify({ error: "Você não tem permissão para visualizar revisão de fatura" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const url = new URL(req.url)
    const status = url.searchParams.get("status") || null
    const cliente = url.searchParams.get("cliente") || null
    const contrato = url.searchParams.get("contrato") || null
    const caso = url.searchParams.get("caso") || null

    // Competência (mês de faturamento) da aba aberta: "YYYY-MM" ou
    // "YYYY-MM-DD". Vai como p_competencia = 1º dia do mês. Sem ela, a chamada
    // é a de sempre (todos os meses) — a Composição depende disso.
    const competenciaRaw = (url.searchParams.get("competencia") || "").trim()
    let competencia: string | null = null
    if (competenciaRaw) {
      const m = competenciaRaw.match(/^(\d{4})-(\d{2})(?:-\d{2})?$/)
      if (!m) {
        return new Response(JSON.stringify({ error: "competencia inválida: use YYYY-MM ou YYYY-MM-01" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }
      competencia = `${m[1]}-${m[2]}-01`
    }

    const { data, error } = await supabase.rpc("get_revisao_fatura", {
      p_user_id: user.id,
      p_status: status,
      p_lote: null,
      p_cliente: cliente,
      p_contrato: contrato,
      p_caso: caso,
      // Só manda o parâmetro quando veio: assim a edge continua funcionando
      // contra a assinatura antiga até a migração 20260922100000 subir.
      ...(competencia ? { p_competencia: competencia } : {}),
    })

    if (error) {
      return new Response(JSON.stringify({ error: error.message, details: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const normalizedData = Array.isArray(data)
      ? data.map((item) => normalizeRevisaoFaturaItem(item))
      : []

    // A RPC devolve enviado_por_foto/revisor_foto/aprovador_foto como o
    // foto_url cru (path no bucket privado). Troca por signed URL em lote;
    // o que não assinar fica como veio.
    const camposFoto = ["enviado_por_foto", "revisor_foto", "aprovador_foto"] as const
    const rows = normalizedData.map((item) => toRecord(item)).filter(Boolean) as Record<string, unknown>[]
    const fotosAssinadas = await assinarFotos(
      supabase,
      rows.flatMap((row) => camposFoto.map((c) => (typeof row[c] === "string" ? (row[c] as string) : null))),
    )
    for (const row of rows) {
      for (const c of camposFoto) {
        const v = row[c]
        if (typeof v === "string" && fotosAssinadas.has(v)) row[c] = fotosAssinadas.get(v)
      }
    }

    return new Response(JSON.stringify({ data: normalizedData }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
})
