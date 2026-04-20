import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

// Immutable fields in finance.revisao_fatura_itens: horas_informadas, valor_informado, data_lancamento, responsavel_fluxo_id.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

const immutableFields = [
  "horas_informadas",
  "valor_informado",
  "data_lancamento",
  "responsavel_fluxo_id",
] as const

function toRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function hasPermissionKey(
  rows: { permission_key: string }[] | null | undefined,
  keys: string[],
) {
  return (rows ?? []).some((p) => keys.includes(p.permission_key))
}

function isApprovalPayload(body: Record<string, unknown>) {
  return (
    Object.prototype.hasOwnProperty.call(body, "horas_aprovadas") ||
    Object.prototype.hasOwnProperty.call(body, "valor_aprovado") ||
    body.status === "aprovado" ||
    body.action === "aprovar"
  )
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

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
    const permissionRows = (permissionsData ?? []) as { permission_key: string }[]
    const canReview = hasPermissionKey(permissionRows, [
      "finance.faturamento.review",
      "finance.faturamento.manage",
      "finance.faturamento.*",
      "finance.*",
      "*",
    ])
    const canApprove = hasPermissionKey(permissionRows, [
      "finance.faturamento.approve",
      "finance.faturamento.manage",
      "finance.faturamento.*",
      "finance.*",
      "*",
    ])
    const hasPermission = canReview || canApprove

    if (!hasPermission) {
      return new Response(JSON.stringify({ error: "Você não tem permissão para editar revisão de fatura" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const rawBody = await req.json().catch(() => ({}))
    const body = toRecord(rawBody) ?? {}

    const immutableField = immutableFields.find((field) => Object.prototype.hasOwnProperty.call(body, field))
    if (immutableField) {
      return new Response(JSON.stringify({ error: `Campo imutável: ${immutableField}` }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    if (body.role === "USUARIO") {
      return new Response(JSON.stringify({ error: "role USUARIO não pode editar revisão" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const role = canApprove && isApprovalPayload(body) ? "APROVADOR" : canReview ? "REVISOR" : "APROVADOR"
    const payload = { ...body, role }

    const { data, error } = await supabase.rpc("update_revisao_fatura_item", {
      p_user_id: user.id,
      p_payload: payload,
    })

    if (error) {
      return new Response(JSON.stringify({ error: error.message, details: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    return new Response(JSON.stringify({ data }), {
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
