import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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
        p.permission_key === "finance.faturamento.write" ||
        p.permission_key === "finance.faturamento.manage" ||
        p.permission_key === "finance.faturamento.*" ||
        p.permission_key === "finance.*" ||
        p.permission_key === "*",
    )

    if (!hasPermission) {
      return new Response(JSON.stringify({ error: "Você não tem permissão para iniciar faturamento" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const body = await req.json().catch(() => ({}))

    const normalizeDate = (value: unknown) => {
      const text = String(value ?? "").trim()
      if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text
      return null
    }

    const isNoEligibleError = (message: unknown) => {
      const normalized = String(message || "").toLowerCase()
      return (
        normalized.includes("nenhum item elegível") ||
        normalized.includes("nenhum item elegivel") ||
        normalized.includes("nenhuma despesa elegível") ||
        normalized.includes("nenhuma despesa elegivel") ||
        normalized.includes("no eligible item")
      )
    }

    const startDespesasFallback = async () => {
      const alvoTipo = String(body?.alvo_tipo || "").toLowerCase()
      const dataInicio = normalizeDate(body?.data_inicio)
      const dataFim = normalizeDate(body?.data_fim)
      if (!["cliente", "contrato", "caso", "itens"].includes(alvoTipo) || !dataInicio || !dataFim) {
        return {
          handled: false,
          created: 0,
          batchId: null as string | null,
          batchNumero: null as number | null,
          errorMessage: null as string | null,
        }
      }

      const { data: fallbackData, error: fallbackError } = await supabase.rpc(
        "start_faturamento_despesas_fallback",
        {
          p_user_id: user.id,
          p_payload: body,
        },
      )

      if (fallbackError) {
        return {
          handled: false,
          created: 0,
          batchId: null as string | null,
          batchNumero: null as number | null,
          errorMessage: fallbackError.message || null,
        }
      }

      return {
        handled: true,
        created: Number(fallbackData?.itens_criados || 0),
        batchId: fallbackData?.batch_id ? String(fallbackData.batch_id) : null,
        batchNumero:
          typeof fallbackData?.batch_numero === "number"
            ? fallbackData.batch_numero
            : Number(fallbackData?.batch_numero || 0),
        errorMessage: null as string | null,
      }
    }

    const { data, error } = await supabase.rpc("start_faturamento_flow", {
      p_user_id: user.id,
      p_payload: body,
    })

    let resultData = data
    if (error) {
      if (isNoEligibleError(error.message)) {
        const fallback = await startDespesasFallback()
        if (fallback.handled && fallback.created > 0) {
          resultData = {
            batch_id: fallback.batchId,
            batch_numero: fallback.batchNumero,
            itens_criados: fallback.created,
            source: "despesa_fallback",
          }
        } else {
          const fallbackMessage = String(fallback.errorMessage || "").trim()
          const finalMessage = fallbackMessage || error.message
          return new Response(JSON.stringify({ error: finalMessage, details: finalMessage }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          })
        }
      } else {
        return new Response(JSON.stringify({ error: error.message, details: error.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }
    }

    const batchId = resultData?.batch_id ?? null
    if (batchId) {
      await supabase.rpc("detach_faturamento_batch", {
        p_user_id: user.id,
        p_batch_id: batchId,
      })
    }

    return new Response(
      JSON.stringify({
        data: {
          itens_criados: resultData?.itens_criados ?? 0,
          batch_numero: resultData?.batch_numero ?? null,
          source: resultData?.source ?? "rpc",
        },
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    )
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
})

