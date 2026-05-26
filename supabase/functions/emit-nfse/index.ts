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
    const { data: { user }, error: userError } = await supabase.auth.getUser(token)
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // Resolve tenant
    const { data: tenantUser } = await supabase
      .schema("core")
      .from("tenant_users")
      .select("tenant_id")
      .eq("user_id", user.id)
      .eq("status", "ativo")
      .limit(1)
      .single()

    if (!tenantUser) {
      return new Response(JSON.stringify({ error: "Usuário não associado a tenant" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const body = await req.json()
    const { contrato_id, billing_item_ids } = body as {
      contrato_id?: string
      billing_item_ids?: string[]
    }

    if (!contrato_id && (!billing_item_ids || billing_item_ids.length === 0)) {
      return new Response(JSON.stringify({ error: "contrato_id ou billing_item_ids é obrigatório" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // Buscar itens aprovados
    let query = supabase
      .schema("finance")
      .from("billing_items")
      .select("id, contrato_id, caso_id, valor_aprovado, valor_revisado, valor, snapshot, status")
      .eq("tenant_id", tenantUser.tenant_id)
      .eq("status", "aprovado")

    if (contrato_id) {
      query = query.eq("contrato_id", contrato_id)
    } else {
      query = query.in("id", billing_item_ids!)
    }

    const { data: items, error: itemsError } = await query
    if (itemsError || !items || items.length === 0) {
      return new Response(JSON.stringify({ error: "Nenhum item aprovado encontrado para este contrato" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // Calcular valor total e discriminação
    const valorTotal = items.reduce((sum, item: any) => {
      return sum + Number(item.valor_aprovado ?? item.valor_revisado ?? item.valor ?? 0)
    }, 0)

    const discriminacaoSet = new Set<string>()
    for (const item of items as any[]) {
      const snap = (item.snapshot as Record<string, unknown>) || {}
      const desc = String(snap.caso_nome || snap.descricao || "Serviços advocatícios")
      discriminacaoSet.add(desc)
    }
    const discriminacao = Array.from(discriminacaoSet).join("; ") || "Serviços advocatícios"

    // Acumulação mensal: buscar cliente do contrato + valor já emitido no mês
    const effectiveContratoId = contrato_id || (items[0] as any).contrato_id
    const { data: contratoData } = await supabase
      .schema("contracts")
      .from("contratos")
      .select("cliente_id, grupo_imposto_id")
      .eq("id", effectiveContratoId)
      .single()

    let acumuladoMes = 0
    if (contratoData?.cliente_id) {
      const now = new Date()
      const competencia = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`
      const { data: acum } = await supabase.rpc("get_client_month_accumulated_value", {
        p_tenant_id: tenantUser.tenant_id,
        p_cliente_id: contratoData.cliente_id,
        p_competencia: competencia,
      })
      acumuladoMes = Number(acum ?? 0)
    }

    // Retenções (não enviadas ao Focus NFe, registradas em billing_notes)
    const RATES = {
      irrf: { aliquota: 1.5, minCalc: 666.67, minRet: 10 },
      pis: { aliquota: 0.65, minCalc: 215.34, minRet: 1.4 },
      cofins: { aliquota: 3.0, minCalc: 215.34, minRet: 6.46 },
      csll: { aliquota: 1.0, minCalc: 215.34, minRet: 2.15 },
    }

    let retemIrrf = true, retemPis = true, retemCofins = true, retemCsll = true
    let respeitaMinimo = true
    const grupoRates = { ...RATES }

    if (contratoData?.grupo_imposto_id) {
      const { data: gi } = await supabase
        .schema("contracts")
        .from("grupos_impostos")
        .select("retem_irrf, retem_pis, retem_cofins, retem_csll, respeita_minimo, aliquota_irrf, aliquota_pis, aliquota_cofins, aliquota_csll, min_calc_irrf, min_calc_pis_cofins_csll, min_ret_irrf, min_ret_pis, min_ret_cofins, min_ret_csll")
        .eq("id", contratoData.grupo_imposto_id)
        .single()

      if (gi) {
        retemIrrf = gi.retem_irrf ?? true
        retemPis = gi.retem_pis ?? true
        retemCofins = gi.retem_cofins ?? true
        retemCsll = gi.retem_csll ?? true
        respeitaMinimo = gi.respeita_minimo ?? true
        grupoRates.irrf = { aliquota: Number(gi.aliquota_irrf ?? RATES.irrf.aliquota), minCalc: Number(gi.min_calc_irrf ?? RATES.irrf.minCalc), minRet: Number(gi.min_ret_irrf ?? RATES.irrf.minRet) }
        grupoRates.pis = { aliquota: Number(gi.aliquota_pis ?? RATES.pis.aliquota), minCalc: Number(gi.min_calc_pis_cofins_csll ?? RATES.pis.minCalc), minRet: Number(gi.min_ret_pis ?? RATES.pis.minRet) }
        grupoRates.cofins = { aliquota: Number(gi.aliquota_cofins ?? RATES.cofins.aliquota), minCalc: Number(gi.min_calc_pis_cofins_csll ?? RATES.cofins.minCalc), minRet: Number(gi.min_ret_cofins ?? RATES.cofins.minRet) }
        grupoRates.csll = { aliquota: Number(gi.aliquota_csll ?? RATES.csll.aliquota), minCalc: Number(gi.min_calc_pis_cofins_csll ?? RATES.csll.minCalc), minRet: Number(gi.min_ret_csll ?? RATES.csll.minRet) }
      }
    }

    const baseCalculo = valorTotal + acumuladoMes
    const calcRet = (retem: boolean, rate: { aliquota: number; minCalc: number; minRet: number }) => {
      if (!retem) return { valor: 0, aplicado: false }
      if (respeitaMinimo && baseCalculo < rate.minCalc) return { valor: 0, aplicado: false }
      const valor = Math.round(valorTotal * rate.aliquota) / 100
      if (respeitaMinimo && valor < rate.minRet) return { valor: 0, aplicado: false }
      return { valor, aplicado: true, acumulacao: acumuladoMes > 0 && valorTotal < rate.minCalc }
    }

    const retencoes = {
      irrf: calcRet(retemIrrf, grupoRates.irrf),
      pis: calcRet(retemPis, grupoRates.pis),
      cofins: calcRet(retemCofins, grupoRates.cofins),
      csll: calcRet(retemCsll, grupoRates.csll),
    }

    // Focus NFe config
    const focusToken = Deno.env.get("FOCUS_NFE_TOKEN") ?? ""
    const focusEnv = Deno.env.get("FOCUS_NFE_ENV") ?? "homologation"
    const focusBase = focusEnv === "production"
      ? "https://api.focusnfe.com.br"
      : "https://homologacao.focusnfe.com.br"

    const cnpjPrestador = (Deno.env.get("FOCUS_NFE_CNPJ") ?? "14491612000139").replace(/\D/g, "")
    const inscricaoMunicipal = Deno.env.get("FOCUS_NFE_INSCRICAO_MUNICIPAL") ?? "6265382"
    const itemListaServico = Deno.env.get("FOCUS_NFE_ITEM_LISTA_SERVICO") ?? "1714"
    const aliquota = Number(Deno.env.get("FOCUS_NFE_ALIQUOTA") ?? "3.5")
    const codigoTributario = Deno.env.get("FOCUS_NFE_CODIGO_TRIBUTARIO") ?? ""

    const ref = `vlma-${Date.now()}`

    const nfsePayload: Record<string, unknown> = {
      prestador: {
        cnpj: cnpjPrestador,
        inscricao_municipal: inscricaoMunicipal,
      },
      servico: {
        valor_servicos: valorTotal.toFixed(2),
        discriminacao,
        item_lista_servico: itemListaServico,
        aliquota,
        ...(codigoTributario ? { codigo_tributario_municipio: codigoTributario } : {}),
      },
    }

    const focusResp = await fetch(`${focusBase}/v2/nfse?ref=${ref}`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(focusToken + ":")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(nfsePayload),
    })

    const focusBody = await focusResp.json().catch(() => ({}))
    const accepted = focusResp.status === 201 || focusResp.status === 200
    const focusStatus = accepted ? "pendente" : "erro"

    // Registrar nota em billing_notes
    const { data: noteData } = await supabase
      .schema("finance")
      .from("billing_notes")
      .insert({
        tenant_id: tenantUser.tenant_id,
        contrato_id: (items[0] as any).contrato_id,
        tipo_documento: "nota_fiscal_servico",
        status: accepted ? "gerado" : "cancelado",
        focus_ref: ref,
        focus_status: focusStatus,
        metadata: {
          focus_response: focusBody,
          item_ids: items.map((i: any) => i.id),
          valor_total: valorTotal,
          discriminacao,
          acumulado_mes: acumuladoMes,
          retencoes,
        },
        created_by: user.id,
      })
      .select("id")
      .single()

    if (!accepted) {
      return new Response(
        JSON.stringify({ error: "Focus NFe recusou a solicitação", focus_response: focusBody }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      )
    }

    return new Response(
      JSON.stringify({
        ok: true,
        ref,
        focus_status: focusStatus,
        nota_id: noteData?.id ?? null,
        valor_total: valorTotal,
        focus_response: focusBody,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    )
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
})
