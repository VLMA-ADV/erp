import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

function digits(v: string | null | undefined): string {
  return (v ?? "").replace(/\D/g, "")
}

// Retorna data ISO em BRT (-03:00) com buffer de segundos no passado.
// Necessário porque a SPED valida que data_emissao <= timestamp do processamento;
// quando enviada em UTC com `Z`, o servidor SPED pode interpretar como futuro
// pela diferença de fuso/relógio. Erro E0008 observado em homologação Curitiba.
function isoBrt(secondsAgo: number = 60): string {
  const ms = Date.now() - secondsAgo * 1000 - 3 * 60 * 60 * 1000
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}-03:00`
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })

  try {
    const authHeader = req.headers.get("Authorization")
    if (!authHeader) return new Response(JSON.stringify({ error: "Missing authorization header" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } })

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } },
    )

    const token = authHeader.replace("Bearer ", "")
    const { data: { user }, error: userError } = await supabase.auth.getUser(token)
    if (userError || !user) return new Response(JSON.stringify({ error: "Invalid token" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } })

    const { data: tenantId } = await supabase.rpc("get_tenant_for_user", { p_user_id: user.id })
    if (!tenantId) return new Response(JSON.stringify({ error: "Usuário não associado a tenant" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } })

    // Emitir NFS-e é restrito à capacidade 'finance.nfse.manage' (sócios + Jessika
    // Lira). Antes, qualquer usuário autenticado conseguia disparar emissão fiscal.
    const { data: podeNfse } = await supabase.rpc("tem_capacidade_sensivel", { p_user_id: user.id, p_capacidade: "finance.nfse.manage" })
    if (podeNfse !== true) return new Response(JSON.stringify({ error: "Sem permissão para emitir NFS-e" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } })

    const body = await req.json()
    const { contrato_id, descricao_servico: descricaoOverride } = body as { contrato_id?: string; descricao_servico?: string }
    if (!contrato_id) return new Response(JSON.stringify({ error: "contrato_id é obrigatório" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } })

    const { data: cfg } = await supabase.rpc("get_focus_nfe_config", { p_tenant_id: tenantId })
    if (!cfg) return new Response(JSON.stringify({ error: "Configuração fiscal não encontrada. Cadastre em /configuracao/fiscal-nfse." }), { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } })

    const { data: dataset } = await supabase.rpc("get_billing_items_aprovados_full", { p_tenant_id: tenantId, p_contrato_id: contrato_id })
    if (!dataset || !dataset.itens || dataset.itens.length === 0) return new Response(JSON.stringify({ error: "Nenhum item aprovado encontrado para este contrato" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } })

    const itens = dataset.itens as Array<{ id: string; valor: number; snapshot: Record<string, unknown> }>
    const tomador = dataset.tomador as Record<string, any> | null
    const grupo = dataset.grupo_imposto as Record<string, any> | null
    const contrato = dataset.contrato as Record<string, any> | null

    if (!tomador) return new Response(JSON.stringify({ error: "Cliente do contrato não encontrado." }), { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } })

    const missingTomador: string[] = []
    if (!tomador.cnpj) missingTomador.push("cnpj")
    if (!tomador.codigo_ibge) missingTomador.push("codigo_ibge")
    if (!tomador.cep) missingTomador.push("cep")
    if (!tomador.rua) missingTomador.push("rua")
    if (!tomador.numero) missingTomador.push("numero")
    if (!tomador.bairro) missingTomador.push("bairro")
    if (missingTomador.length > 0) {
      return new Response(JSON.stringify({ error: `Cliente ${tomador.nome} sem dados fiscais completos. Faltam: ${missingTomador.join(", ")}. Preencha em /pessoas/clientes.` }), { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } })
    }

    if (!grupo || !grupo.codigo_tributacao_nacional_iss || !grupo.codigo_nbs || !grupo.aliquota_iss) {
      return new Response(JSON.stringify({ error: "Contrato sem grupo de impostos configurado para NFS-e. Selecione um grupo válido no contrato." }), { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } })
    }

    const valorTotal = itens.reduce((s, i) => s + Number(i.valor ?? 0), 0)
    const valorIss = Math.round(valorTotal * Number(grupo.aliquota_iss) * 100) / 10000
    const valorIssRounded = Math.round(valorIss * 100) / 100

    // Descrição do serviço = texto VARIÁVEL (nome do caso) + bloco FIXO.
    // Texto variável: nomes dos casos dos itens aprovados (dedup, juntados por "; ").
    const casoNomes = Array.from(new Set(
      itens
        .map((it) => String((it.snapshot as any)?.caso_nome || (it.snapshot as any)?.descricao || "").trim())
        .filter(Boolean),
    ))
    const textoVariavel = casoNomes.join("; ")
    // Texto fixo (VLMA) — dados bancários/Pix e nota da Lei 12.741/LC 214 são
    // literais por enquanto. Se mudar Ag./C-C/Pix ou o % aproximado, é aqui.
    const DESCRICAO_FIXA = [
      "Honorários Advocatícios",
      "Pagamento conforme boleto bancário em anexo",
      "Dados bancários: Banco Itaú (341) - Ag. 3835 - C/C 31141-0",
      "Pix/CNPJ: 14.491.612/0001-39",
      "Conforme Lei 12.741/2012 o valor aproximado dos tributos é 14,53%. Em atendimento à Reforma Tributária (LC 214/2025), nesta operação são informados 0,1% a título de IBS e 0,9% a título de CBS para fins de obrigação acessória no ano-teste de 2026.",
    ].join("\n")
    const discriminacao = [textoVariavel, DESCRICAO_FIXA].filter(Boolean).join("\n")
    // Override: se o usuário editou a descrição na prévia, usa o texto dele.
    const descricaoFinal = (descricaoOverride && descricaoOverride.trim()) ? descricaoOverride.trim() : discriminacao

    const { data: numeroDps } = await supabase.rpc("allocate_numero_dps", { p_tenant_id: tenantId })

    const focusToken = Deno.env.get("FOCUS_NFE_TOKEN") ?? ""
    const focusBase = cfg.focus_env === "production" ? "https://api.focusnfe.com.br" : "https://homologacao.focusnfe.com.br"
    const ref = `vlma-${tenantId}-${contrato_id}-${Date.now()}`

    const dataEmissao = isoBrt(60) // 60s no passado em BRT (-03:00) — evita erro E0008 SPED
    const dataCompetencia = dataEmissao.slice(0, 10)

    // ── Retenções federais (IRRF, PIS, COFINS, CSLL) ──────────────────────────
    // Replica exatamente a lógica do preview (nfse-preview-dialog.tsx): lê as
    // colunas do grupo (retem_*, aliquota_*, min_calc_*, min_ret_*) e respeita o
    // valor acumulado do cliente no mês p/ atingir os mínimos de cálculo.
    // Pós-Reforma Tributária a retenção de PIS+COFINS+CSLL é UNIFICADA na tag
    // vRetCSLL (campo `valor_csll`); `valor_pis`/`valor_cofins` carregam só o
    // débito de apuração própria do prestador. Comprovado pela NFS-e 1386 (Curitiba).
    const clienteId = contrato?.cliente_id ?? (tomador as any)?.id ?? null
    let acumuladoMes = 0
    if (clienteId) {
      const { data: acum } = await supabase.rpc("get_client_month_accumulated_value", {
        p_tenant_id: tenantId,
        p_cliente_id: clienteId,
        p_competencia: dataCompetencia.slice(0, 7),
      })
      acumuladoMes = Number(acum ?? 0)
    }
    const gi = grupo as Record<string, any>
    const baseMin = valorTotal + acumuladoMes
    const respeitaMin = gi.respeita_minimo ?? true
    const calcRet = (
      imp: "irrf" | "pis" | "cofins" | "csll",
      aliqDef: number, minCalcCol: string, minCalcDef: number, minRetDef: number,
    ): number => {
      if ((gi[`retem_${imp}`] ?? true) === false) return 0
      const aliquota = Number(gi[`aliquota_${imp}`] ?? aliqDef)
      const minCalc = Number(gi[minCalcCol] ?? minCalcDef)
      const minRet = Number(gi[`min_ret_${imp}`] ?? minRetDef)
      if (respeitaMin && baseMin < minCalc) return 0
      const valor = Math.round(valorTotal * aliquota) / 100
      if (respeitaMin && valor < minRet) return 0
      return valor
    }
    const vIrrf    = calcRet("irrf",   1.5,  "min_calc_irrf",            666.67, 10.00)
    const vPis     = calcRet("pis",    0.65, "min_calc_pis_cofins_csll", 215.34, 1.40)
    const vCofins  = calcRet("cofins", 3.0,  "min_calc_pis_cofins_csll", 215.34, 6.46)
    const vCsllRet = calcRet("csll",   1.0,  "min_calc_pis_cofins_csll", 215.34, 2.15)
    // vRetCSLL agrupa a soma de PIS+COFINS+CSLL retidos (campo `valor_csll`).
    const vRetUnificada = Math.round((vPis + vCofins + vCsllRet) * 100) / 100
    // tipo_retencao_pis_cofins (tpRetPisCofins): código pela combinação retida.
    const tpKey = `${vPis > 0 ? 1 : 0}${vCofins > 0 ? 1 : 0}${vCsllRet > 0 ? 1 : 0}`
    const tpRetMap: Record<string, number> = {
      "111": 3, "110": 4, "100": 5, "010": 6, "011": 7, "001": 8, "101": 9, "000": 0,
    }
    const tpRetPisCofins = tpRetMap[tpKey] ?? 0

    // 6 = Sociedade de Profissionais (VLMA, advocacia — tributação fixa de ISS).
    // Confirmado pela NFS-e 1386 autorizada em Curitiba. Antes forçávamos 0
    // (Nenhum) só p/ furar o E0178, o que deixava o ISS sendo apurado por valor.
    const regimeEsp = Number(cfg.regime_especial_tributacao ?? 6)

    const retencoesFederais: Record<string, unknown> = {}
    if (vIrrf > 0) retencoesFederais.valor_irrf = vIrrf
    if (vPis > 0) retencoesFederais.valor_pis = vPis
    if (vCofins > 0) retencoesFederais.valor_cofins = vCofins
    if (vRetUnificada > 0) retencoesFederais.valor_csll = vRetUnificada
    if (tpRetPisCofins !== 0) retencoesFederais.tipo_retencao_pis_cofins = tpRetPisCofins

    const nfsePayload: Record<string, unknown> = {
      data_emissao: dataEmissao,
      data_competencia: dataCompetencia,
      serie_dps: cfg.serie_dps,
      numero_dps: String(numeroDps ?? 1),

      cnpj_prestador: digits(cfg.cnpj),
      inscricao_municipal_prestador: cfg.inscricao_municipal ?? undefined,
      // codigo_municipio_prestador REMOVIDO: em auto-emissão (prestador = emitente)
      // ele faz o Focus montar o bloco endNac do prestador, que então exige CEP/xLgr
      // — campos que a prefeitura proíbe nesse caso. O endereço vem do cadastro
      // nacional. Mantemos emissora/prestacao (cabeçalho da DPS, não são endereço).
      codigo_municipio_emissora: Number(cfg.codigo_municipio),
      codigo_municipio_prestacao: Number(cfg.codigo_municipio),
      telefone_prestador: digits(cfg.telefone),
      email_prestador: cfg.email,
      codigo_opcao_simples_nacional: cfg.codigo_opcao_simples_nacional,
      // O grupo regTrib (SPED) exige UM de: regApTribSN (Simples) OU regEspTrib.
      // VLMA é NÃO optante do Simples (codigo_opcao_simples_nacional=1), então usa
      // regEspTrib = 6 (Sociedade de Profissionais), que é o enquadramento real da
      // advocacia e o que a NFS-e 1386 autorizada mostra. O 3 (Microempresa
      // Municipal) é que Curitiba recusou com E0178.
      regime_especial_tributacao: regimeEsp,
      // NÃO enviar endereço do prestador: quando o próprio prestador é o emitente
      // da DPS (auto-emissão, caso da VLMA), o endereço vem do cadastro nacional.
      // Informá-lo aqui é rejeitado pela prefeitura ("endereço nacional do prestador
      // não deve ser informado quando o prestador for o emitente da DPS").

      cnpj_tomador: digits(tomador.cnpj),
      razao_social_tomador: tomador.nome,
      codigo_municipio_tomador: Number(tomador.codigo_ibge),
      cep_tomador: digits(tomador.cep),
      logradouro_tomador: tomador.rua,
      numero_tomador: String(tomador.numero),
      complemento_tomador: tomador.complemento || "-",
      bairro_tomador: tomador.bairro,
      telefone_tomador: digits(tomador.telefone) || undefined,
      email_tomador: tomador.email || undefined,

      codigo_tributacao_nacional_iss: grupo.codigo_tributacao_nacional_iss,
      codigo_nbs: grupo.codigo_nbs,
      descricao_servico: descricaoFinal,
      valor_servico: Number(valorTotal.toFixed(2)),
      // ISS: tipo_retencao_iss=1 já é "Não Retido" na spec nacional. Sob regime 6
      // (Sociedade de Profissionais) o ISS é tributação FIXA — não se apura por
      // valor — então NÃO enviamos valor_iss (bate com "ISSQN Apurado: -" da 1386).
      ...(regimeEsp === 6 ? {} : { valor_iss: valorIssRounded }),
      tributacao_iss: grupo.tributacao_iss,
      tipo_retencao_iss: grupo.tipo_retencao_iss,
      situacao_tributaria_pis_cofins: grupo.situacao_tributaria_pis_cofins,
      // Retenções federais (valor_irrf, valor_pis, valor_cofins, valor_csll
      // unificado, tipo_retencao_pis_cofins) — só entram quando o grupo retém.
      ...retencoesFederais,
      percentual_total_tributos_federais: String(grupo.pct_trib_federais ?? 0),
      percentual_total_tributos_estaduais: String(grupo.pct_trib_estaduais ?? 0),
      percentual_total_tributos_municipais: String(grupo.pct_trib_municipais ?? 0),
    }

    const focusResp = await fetch(`${focusBase}/v2/nfsen?ref=${ref}`, {
      method: "POST",
      headers: { Authorization: `Basic ${btoa(focusToken + ":")}`, "Content-Type": "application/json" },
      body: JSON.stringify(nfsePayload),
    })

    const focusBody = await focusResp.json().catch(() => ({}))
    // Focus NFe retorna 202 (Accepted) para emissões async (NFSe Nacional) — também é sucesso.
    // Tratar como erro apenas se houver código de erro explícito ou status >= 400.
    const accepted = focusResp.status >= 200 && focusResp.status < 300 && !(focusBody as any)?.codigo

    // focus_status: usa o status retornado pelo Focus (ex.: "processando_autorizacao") ou fallback
    const focusStatus = accepted ? String((focusBody as any)?.status ?? "pendente") : "erro"

    const { data: noteId } = await supabase.rpc("insert_billing_note", {
      p_tenant_id: tenantId,
      p_contrato_id: contrato_id,
      p_tipo_documento: "nota_fiscal_servico",
      p_status: accepted ? "gerado" : "cancelado",
      p_focus_ref: ref,
      p_focus_status: focusStatus,
      p_metadata: { focus_request: nfsePayload, focus_response: focusBody, item_ids: itens.map(i => i.id), valor_total: valorTotal, valor_iss: valorIssRounded },
      p_created_by: user.id,
    })

    if (!accepted) {
      return new Response(JSON.stringify({ error: "Focus NFe recusou a solicitação", focus_response: focusBody, ref, nota_id: noteId }), { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } })
    }

    return new Response(JSON.stringify({ ok: true, ref, focus_status: focusStatus, nota_id: noteId, valor_total: valorTotal, valor_iss: valorIssRounded, focus_response: focusBody }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } })
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } })
  }
})
