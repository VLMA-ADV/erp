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
    let mainNoEligible = false
    if (error) {
      if (isNoEligibleError(error.message)) {
        mainNoEligible = true
        resultData = null
      } else {
        return new Response(JSON.stringify({ error: error.message, details: error.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }
    }

    // Despesa não é "regra": "Gerar faturamento do mês" (somente_regras) continua
    // sem arrastar despesa, igual já faz com hora (call Filipe 08/07) — decisão de
    // produto que não é deste conserto.
    //
    // Mas no envio por caso/contrato/cliente (itens-a-faturar-list.tsx), despesa
    // varria só quando o escopo tinha ZERO timesheet/regra elegível — a exceção
    // "nenhum item elegível" era a ÚNICA porta para o fallback rodar. Bastava o
    // caso ter UMA hora pendente (quase sempre tem) que a despesa ficava pra trás,
    // silenciosamente, sem erro nenhum. Foi o que o Filipe viu em 02/09: ~30k em
    // despesas já lançadas que nunca chegam na grid de revisão porque o caso
    // delas sempre tem alguma hora também elegível no mesmo envio.
    // Agora a varredura de despesa roda sempre (mesmo quando o fluxo principal
    // já achou item), somando ao mesmo resultado, em vez de só no erro.
    const somenteRegras = Boolean(body?.somente_regras)
    let despesasCreated = 0
    let despesasBatchId: string | null = null
    let despesasBatchNumero: number | null = null
    let despesasErrorMessage: string | null = null

    if (!somenteRegras) {
      const fallback = await startDespesasFallback()
      if (fallback.handled) {
        if (fallback.created > 0) {
          despesasCreated = fallback.created
          despesasBatchId = fallback.batchId
          despesasBatchNumero = fallback.batchNumero
        }
      } else if (fallback.errorMessage && !isNoEligibleError(fallback.errorMessage)) {
        // Erro de verdade (não "sem despesa elegível") — não derruba um envio de
        // timesheet/regra que já tenha dado certo, mas precisa aparecer.
        despesasErrorMessage = fallback.errorMessage
      }
    }

    if (!resultData && despesasCreated === 0) {
      if (mainNoEligible) {
        const finalMessage = despesasErrorMessage || error!.message
        return new Response(JSON.stringify({ error: finalMessage, details: finalMessage }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }
    }

    if (!resultData && despesasCreated > 0) {
      resultData = {
        batch_id: despesasBatchId,
        batch_numero: despesasBatchNumero,
        itens_criados: despesasCreated,
        source: "despesa_fallback",
      }
    } else if (resultData && despesasCreated > 0) {
      resultData = {
        ...resultData,
        itens_criados: Number(resultData.itens_criados ?? 0) + despesasCreated,
        despesas_batch_id: despesasBatchId,
        despesas_batch_numero: despesasBatchNumero,
        despesas_itens_criados: despesasCreated,
      }
    }

    const batchIds = [resultData?.batch_id, resultData?.despesas_batch_id].filter(
      (id: unknown): id is string => typeof id === "string" && id.length > 0,
    )
    for (const id of batchIds) {
      await supabase.rpc("detach_faturamento_batch", {
        p_user_id: user.id,
        p_batch_id: id,
      })
    }

    return new Response(
      JSON.stringify({
        data: {
          itens_criados: resultData?.itens_criados ?? 0,
          batch_numero: resultData?.batch_numero ?? null,
          despesas_batch_numero: resultData?.despesas_batch_numero ?? null,
          despesas_itens_criados: resultData?.despesas_itens_criados ?? 0,
          mensagem: resultData?.mensagem ?? despesasErrorMessage ?? null,
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

