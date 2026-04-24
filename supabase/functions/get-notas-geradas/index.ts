import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

function isMissingRpcError(message: string) {
  const normalized = String(message || "").toLowerCase()
  return (
    normalized.includes("could not find the function public.get_notas_geradas") ||
    (normalized.includes("function public.get_notas_geradas") && normalized.includes("schema cache"))
  )
}

function getTenantIdFromRpc(data: any): string | null {
  if (!data) return null
  if (Array.isArray(data)) {
    const first = data[0]
    if (first && typeof first === "object" && "tenant_id" in first && first.tenant_id) {
      return String(first.tenant_id)
    }
    return null
  }
  if (typeof data === "object" && "tenant_id" in data && data.tenant_id) {
    return String(data.tenant_id)
  }
  return null
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
      (permission: any) =>
        permission.permission_key === "finance.faturamento.read" ||
        permission.permission_key === "finance.faturamento.manage" ||
        permission.permission_key === "finance.faturamento.*" ||
        permission.permission_key === "finance.*" ||
        permission.permission_key === "*",
    )

    if (!hasPermission) {
      return new Response(JSON.stringify({ error: "Você não tem permissão para visualizar notas geradas" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const url = new URL(req.url)
    const status = url.searchParams.get("status") || null
    const tipoDocumento = url.searchParams.get("tipo_documento") || null
    const search = url.searchParams.get("search") || null
    const limitParam = Number(url.searchParams.get("limit") || "200")
    const limit = Number.isFinite(limitParam) ? limitParam : 200

    const { data, error } = await supabase.rpc("get_notas_geradas", {
      p_user_id: user.id,
      p_status: status,
      p_tipo_documento: tipoDocumento,
      p_search: search,
      p_limit: limit,
    })

    if (error && !isMissingRpcError(error.message)) {
      return new Response(JSON.stringify({ error: error.message, details: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    if (!error) {
      return new Response(JSON.stringify({ data: data || [] }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const { data: tenantData, error: tenantError } = await supabase.rpc("get_user_tenant", { p_user_id: user.id })
    if (tenantError) {
      return new Response(JSON.stringify({ error: tenantError.message, details: tenantError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const tenantId = getTenantIdFromRpc(tenantData)
    if (!tenantId) {
      return new Response(JSON.stringify({ error: "Tenant não encontrado para o usuário." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    let notesQuery = supabase
      .schema("finance")
      .from("billing_notes")
      .select("id, numero, status, tipo_documento, arquivo_nome, arquivo_url, metadata, created_at, created_by, billing_batch_id, contrato_id, caso_id")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(limit)

    if (status) notesQuery = notesQuery.eq("status", status)
    if (tipoDocumento) notesQuery = notesQuery.eq("tipo_documento", tipoDocumento)

    const { data: rawNotes, error: notesError } = await notesQuery
    if (notesError) {
      return new Response(JSON.stringify({ error: notesError.message, details: notesError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const notes = Array.isArray(rawNotes) ? rawNotes : []
    const batchIds = Array.from(new Set(notes.map((n: any) => n.billing_batch_id).filter(Boolean)))
    const contratoIds = Array.from(new Set(notes.map((n: any) => n.contrato_id).filter(Boolean)))
    const casoIds = Array.from(new Set(notes.map((n: any) => n.caso_id).filter(Boolean)))

    const [batchResult, contratoResult, casoResult] = await Promise.all([
      batchIds.length > 0
        ? supabase.schema("finance").from("billing_batches").select("id, numero").eq("tenant_id", tenantId).in("id", batchIds)
        : Promise.resolve({ data: [], error: null } as any),
      contratoIds.length > 0
        ? supabase.schema("contracts").from("contratos").select("id, numero, nome_contrato").eq("tenant_id", tenantId).in("id", contratoIds)
        : Promise.resolve({ data: [], error: null } as any),
      casoIds.length > 0
        ? supabase.schema("contracts").from("casos").select("id, numero, nome").eq("tenant_id", tenantId).in("id", casoIds)
        : Promise.resolve({ data: [], error: null } as any),
    ])

    if (batchResult.error || contratoResult.error || casoResult.error) {
      const firstError = batchResult.error || contratoResult.error || casoResult.error
      return new Response(JSON.stringify({ error: firstError.message, details: firstError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const batchById = new Map((batchResult.data || []).map((row: any) => [row.id, row]))
    const contratoById = new Map((contratoResult.data || []).map((row: any) => [row.id, row]))
    const casoById = new Map((casoResult.data || []).map((row: any) => [row.id, row]))

    const mapped = notes.map((note: any) => {
      const batch = batchById.get(note.billing_batch_id)
      const contrato = contratoById.get(note.contrato_id)
      const caso = casoById.get(note.caso_id)
      return {
        id: note.id,
        numero: note.numero,
        status: note.status,
        tipo_documento: note.tipo_documento,
        arquivo_nome: note.arquivo_nome,
        arquivo_url: note.arquivo_url,
        metadata: note.metadata,
        created_at: note.created_at,
        created_by: note.created_by,
        billing_batch_id: note.billing_batch_id,
        batch_numero: batch?.numero ?? null,
        contrato_id: note.contrato_id,
        contrato_numero: contrato?.numero ?? null,
        contrato_nome: contrato?.nome_contrato ?? null,
        caso_id: note.caso_id,
        caso_numero: caso?.numero ?? null,
        caso_nome: caso?.nome ?? null,
      }
    })

    const normalizedSearch = String(search || "").trim().toLowerCase()
    const filtered = normalizedSearch
      ? mapped.filter((row: any) => {
          const haystack = [
            row.numero,
            row.arquivo_nome,
            row.arquivo_url,
            row.contrato_nome,
            row.caso_nome,
            row.batch_numero,
            row.metadata ? JSON.stringify(row.metadata) : "",
          ]
            .map((value) => String(value || "").toLowerCase())
            .join(" ")
          return haystack.includes(normalizedSearch)
        })
      : mapped

    return new Response(JSON.stringify({ data: filtered.slice(0, limit) }), {
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

