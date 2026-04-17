import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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

function normalizeRevisaoFaturaItem(item: unknown) {
  const row = toRecord(item)
  if (!row) return item

  const snapshot = toRecord(row.snapshot) ?? {}

  return {
    ...row,
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

    const { data, error } = await supabase.rpc("get_revisao_fatura", {
      p_user_id: user.id,
      p_status: status,
      p_lote: null,
      p_cliente: cliente,
      p_contrato: contrato,
      p_caso: caso,
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
