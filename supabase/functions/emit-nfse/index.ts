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

const DESCRICAO_FIXA = [
  "Honorários Advocatícios",
  "Pagamento conforme boleto bancário em anexo",
  "Dados bancários: Banco Itaú (341) - Ag. 3835 - C/C 31141-0",
  "Pix/CNPJ: 14.491.612/0001-39",
  "Conforme Lei 12.741/2012 o valor aproximado dos tributos é 14,53%. Em atendimento à Reforma Tributária (LC 214/2025), nesta operação são informados 0,07% a título de IBS e 0,63% a título de CBS para fins de obrigação acessória no ano-teste de 2026.",
].join("\n")

// IBS/CBS — Reforma Tributária (LC 214/2025), pedido Filipe 12/08.
//
// 2026 é ano-teste: sem custo nem recolhimento, mas o preenchimento é
// obrigatório para a nota nao travar na emissao. As aliquotas BASE do
// ano-teste para servicos sao fixas pelo governo (0,10% IBS-UF, 0,00% IBS-Mun
// em Curitiba, 0,90% CBS) — nao e algo que a VLMA escolhe. Manda-se a aliquota
// base + o percentual de reducao; quem calcula a aliquota efetiva (a que
// aparece na DANFSe) e o proprio processamento nacional, nao nos.
//
// A reducao de 30% e porque advocacia e profissao intelectual regulamentada
// (CST 200 / cClassTrib 200052) — mesma nota de exemplo (NFSe 1820) confere:
// base 0,10/0,90 * (100-30)/100 = efetiva 0,07/0,63.
const IBS_CBS_REFORMA = {
  situacao_tributaria: "200", // CST — tributacao regular
  classificacao_tributaria: "200052", // cClassTrib — profissoes intelectuais regulamentadas
  indicador_operacao: "030101", // operacao regular dentro do municipio de incidencia
  ibs_uf_aliquota: "0.10",
  ibs_mun_aliquota: "0.00",
  cbs_aliquota: "0.90",
  ibs_uf_percentual_reducao: "30.00",
  ibs_mun_percentual_reducao: "30.00",
  cbs_percentual_reducao: "30.00",
}

type Pagador = {
  cliente_id: string
  cliente: Record<string, any> | null
  valor_total: number
  item_ids: string[]
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })

  const json = (body: unknown, status: number) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } })

  try {
    const authHeader = req.headers.get("Authorization")
    if (!authHeader) return json({ error: "Missing authorization header" }, 401)

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } },
    )

    const token = authHeader.replace("Bearer ", "")
    const { data: { user }, error: userError } = await supabase.auth.getUser(token)
    if (userError || !user) return json({ error: "Invalid token" }, 401)

    const { data: tenantId } = await supabase.rpc("get_tenant_for_user", { p_user_id: user.id })
    if (!tenantId) return json({ error: "Usuário não associado a tenant" }, 403)

    // Emitir NFS-e é restrito à capacidade 'finance.nfse.manage' (sócios + Jessika Lira).
    const { data: podeNfse } = await supabase.rpc("tem_capacidade_sensivel", { p_user_id: user.id, p_capacidade: "finance.nfse.manage" })
    if (podeNfse !== true) return json({ error: "Sem permissão para emitir NFS-e" }, 403)

    const body = await req.json()
    const { contrato_id, caso_id, descricao_servico: descricaoOverride, dry_run } = body as
      { contrato_id?: string; caso_id?: string; descricao_servico?: string; dry_run?: boolean }

    // ENSAIO. Monta tudo e devolve o que SERIA emitido, sem chamar a prefeitura
    // e sem gravar nota. Existia em junho, sumiu num refactor, e volta agora
    // porque o ambiente e producao: e a unica forma de conferir a quebra por
    // caso sem mandar nota fiscal de verdade.
    const ensaio = dry_run === true
    if (!contrato_id) return json({ error: "contrato_id é obrigatório" }, 400)

    // ESCOPO DA NOTA. Com caso_id, a nota cobre so aquele caso — e o cliente
    // recebe o detalhamento por escopo, que e o que o Filipe pediu em 03/09:
    // "uma nota por caso e nao por contrato".
    //
    // Sem caso_id, mantem o comportamento antigo: contrato inteiro. E o que o
    // contrato marcado como 'agrupar_nota_por_contrato' usa.
    const escopoCaso = typeof caso_id === "string" && caso_id ? caso_id : null

    const { data: cfg } = await supabase.rpc("get_focus_nfe_config", { p_tenant_id: tenantId })
    if (!cfg) return json({ error: "Configuração fiscal não encontrada. Cadastre em /configuracao/fiscal-nfse." }, 422)

    const { data: dataset } = await supabase.rpc("get_billing_items_aprovados_full", {
      p_tenant_id: tenantId,
      p_contrato_id: contrato_id,
      p_caso_id: escopoCaso,
    })
    if (!dataset || !dataset.itens || dataset.itens.length === 0) {
      return json({
        error: escopoCaso
          ? "Nenhum item aprovado encontrado para este caso"
          : "Nenhum item aprovado encontrado para este contrato",
      }, 404)
    }

    const itens = dataset.itens as Array<{ id: string; valor: number; snapshot: Record<string, unknown> }>
    const grupo = dataset.grupo_imposto as Record<string, any> | null
    // Split por pagador (rateio): uma NFS-e por pagador, valor proporcional ao %.
    // Caso sem rateio => 1 pagador (cliente do contrato) a 100% => 1 nota.
    const pagadores = (dataset.pagadores ?? []) as Pagador[]

    if (pagadores.length === 0) return json({ error: "Nenhum pagador resolvido para o contrato." }, 422)

    // Aliquota ZERO e valida: o escritorio recolhe ISS por valor fixo, por ser
    // sociedade de advogados (Filipe, 07/08). O teste antigo era `!aliquota_iss`,
    // que trata 0 como ausente — o grupo estava certo e a emissao era recusada,
    // com uma mensagem mandando conferir justamente o que ja estava configurado.
    const faltando: string[] = []
    if (!grupo) {
      faltando.push("grupo de impostos")
    } else {
      if (!grupo.codigo_tributacao_nacional_iss) faltando.push("código de tributação nacional do ISS")
      if (!grupo.codigo_nbs) faltando.push("código NBS")
      if (grupo.aliquota_iss === null || grupo.aliquota_iss === undefined || grupo.aliquota_iss === "") {
        faltando.push("alíquota de ISS")
      }
    }
    if (faltando.length > 0) {
      return json({
        error: `Grupo de impostos do contrato incompleto para NFS-e. Falta: ${faltando.join(", ")}. Ajuste em Configuração > Grupos de impostos.`,
      }, 422)
    }

    // ── Pré-validação: dados fiscais de TODOS os pagadores ANTES de emitir
    // qualquer nota. Evita emissão parcial (uma nota sai, outra falha por dado
    // faltando). Se qualquer pagador estiver incompleto, nada é emitido.
    for (const p of pagadores) {
      const t = p.cliente
      if (!t) return json({ error: `Pagador ${p.cliente_id} não encontrado no cadastro de clientes.` }, 422)
      const missing: string[] = []
      if (!t.cnpj) missing.push("cnpj")
      if (!t.codigo_ibge) missing.push("codigo_ibge")
      if (!t.cep) missing.push("cep")
      if (!t.rua) missing.push("rua")
      if (!t.numero) missing.push("numero")
      if (!t.bairro) missing.push("bairro")
      if (missing.length > 0) {
        return json({ error: `Pagador ${t.nome} sem dados fiscais completos. Faltam: ${missing.join(", ")}. Preencha em /pessoas/clientes.` }, 422)
      }
    }

    // ── Idempotência: reserva atômica de TODOS os itens (aprovado -> faturado)
    // antes de qualquer emissão. 2º clique não acha item 'aprovado' e é barrado.
    const allItemIds = itens.map((i) => i.id)
    // Ensaio NAO reserva: reservar move o item de 'aprovado' para 'faturado', e
    // um ensaio que muda o estado dos itens nao e ensaio — deixaria o caso
    // travado sem nota nenhuma.
    if (!ensaio) {
      const { data: claimed, error: claimErr } = await supabase.rpc("claim_itens_faturamento", { p_user_id: user.id, p_tenant_id: tenantId, p_item_ids: allItemIds })
      if (claimErr) return json({ error: "Falha ao reservar itens para faturamento", details: claimErr.message }, 500)
      if (Number(claimed) !== allItemIds.length) {
        return json({ error: "Estes itens já estão sendo faturados ou já foram faturados. Atualize a página e verifique as notas emitidas." }, 409)
      }
    }

    const itemById = new Map(itens.map((i) => [i.id, i]))
    // Focus usa tokens distintos por ambiente; em homologacao, cai no token
    // de homologacao (e nunca no de producao, para o teste nao virar nota real).
    const focusToken = cfg?.focus_env === "production"
      ? (Deno.env.get("FOCUS_NFE_TOKEN") ?? "")
      : (Deno.env.get("FOCUS_NFE_TOKEN_HOMOLOGACAO") ?? "")
    const focusBase = cfg.focus_env === "production" ? "https://api.focusnfe.com.br" : "https://homologacao.focusnfe.com.br"
    const dataEmissao = isoBrt(60)
    const dataCompetencia = dataEmissao.slice(0, 10)
    const gi = grupo as Record<string, any>
    const regimeEsp = Number(cfg.regime_especial_tributacao ?? 6)
    const respeitaMin = gi.respeita_minimo ?? true
    // Override de descrição só faz sentido para nota única (a prévia é por
    // contrato). Com rateio (N notas) usa a descrição automática por pagador.
    const usarOverride = pagadores.length === 1 && !!(descricaoOverride && descricaoOverride.trim())

    // Emite UMA NFS-e para um pagador com o seu valor proporcional.
    const emitirNota = async (p: Pagador) => {
      const tomador = p.cliente as Record<string, any>
      const valorTotal = Number(p.valor_total ?? 0)
      const valorIssRounded = Math.round((valorTotal * Number(grupo.aliquota_iss)) * 100) / 10000
      const valorIss = Math.round(valorIssRounded * 100) / 100

      const casoNomes = Array.from(new Set(
        p.item_ids
          .map((id) => itemById.get(id))
          .map((it) => String((it?.snapshot as any)?.caso_nome || (it?.snapshot as any)?.descricao || "").trim())
          .filter(Boolean),
      ))
      const discriminacao = [casoNomes.join("; "), DESCRICAO_FIXA].filter(Boolean).join("\n")
      const descricaoFinal = usarOverride ? (descricaoOverride as string).trim() : discriminacao

      // Acumulado mensal por TOMADOR (o pagador que recebe a nota) — mínimos de retenção.
      let acumuladoMes = 0
      if (tomador?.id) {
        const { data: acum } = await supabase.rpc("get_client_month_accumulated_value", {
          p_tenant_id: tenantId, p_cliente_id: tomador.id, p_competencia: dataCompetencia.slice(0, 7),
        })
        acumuladoMes = Number(acum ?? 0)
      }
      const baseMin = valorTotal + acumuladoMes
      const calcRet = (imp: "irrf" | "pis" | "cofins" | "csll", aliqDef: number, minCalcCol: string, minCalcDef: number, minRetDef: number): number => {
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
      const vRetUnificada = Math.round((vPis + vCofins + vCsllRet) * 100) / 100
      const tpKey = `${vPis > 0 ? 1 : 0}${vCofins > 0 ? 1 : 0}${vCsllRet > 0 ? 1 : 0}`
      const tpRetMap: Record<string, number> = { "111": 3, "110": 4, "100": 5, "010": 6, "011": 7, "001": 8, "101": 9, "000": 0 }
      const tpRetPisCofins = tpRetMap[tpKey] ?? 0

      const retencoesFederais: Record<string, unknown> = {}
      if (vIrrf > 0) retencoesFederais.valor_irrf = vIrrf
      if (vPis > 0) retencoesFederais.valor_pis = vPis
      if (vCofins > 0) retencoesFederais.valor_cofins = vCofins
      if (vRetUnificada > 0) retencoesFederais.valor_csll = vRetUnificada
      if (tpRetPisCofins !== 0) retencoesFederais.tipo_retencao_pis_cofins = tpRetPisCofins

      const { data: numeroDps } = await supabase.rpc("allocate_numero_dps", { p_tenant_id: tenantId })
      const ref = `vlma-${tenantId}-${contrato_id}-${p.cliente_id}-${Date.now()}`

      const nfsePayload: Record<string, unknown> = {
        data_emissao: dataEmissao,
        data_competencia: dataCompetencia,
        // finNFSe: exigido no XSD antes do grupo de reforma (IBS/CBS) — sem
        // ele o schema esperava finNFSe onde recebeu cIndOp e recusava.
        // 0 = NFS-e regular.
        finalidade_emissao: 0,
        // indDest: schema pede um entre indZFMALC/tpOper/gRefNFSe/tpEnteGov/
        // indDest logo apos finNFSe. 0 = operacao comum (nao ZFM/ALC, nao
        // orgao publico, nao substituindo nota anterior).
        indicador_destinatario: 0,
        serie_dps: cfg.serie_dps,
        numero_dps: String(numeroDps ?? 1),
        cnpj_prestador: digits(cfg.cnpj),
        inscricao_municipal_prestador: cfg.inscricao_municipal ?? undefined,
        codigo_municipio_emissora: Number(cfg.codigo_municipio),
        codigo_municipio_prestacao: Number(cfg.codigo_municipio),
        telefone_prestador: digits(cfg.telefone),
        email_prestador: cfg.email,
        codigo_opcao_simples_nacional: cfg.codigo_opcao_simples_nacional,
        regime_especial_tributacao: regimeEsp,
        // Pessoa fisica vai em cpf_tomador. O campo cnpj_tomador e validado pela
        // prefeitura contra o padrao [0-9A-Z]{14}: mandar um CPF de 11 digitos
        // ali derruba a nota com 'erro_validacao_schema'. Eram 566 clientes PF
        // na base, todos com a emissao quebrada.
        ...(digits(tomador.cnpj).length === 11
          ? { cpf_tomador: digits(tomador.cnpj) }
          : { cnpj_tomador: digits(tomador.cnpj) }),
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
        ...(regimeEsp === 6 ? {} : { valor_iss: valorIss }),
        tributacao_iss: grupo.tributacao_iss,
        tipo_retencao_iss: grupo.tipo_retencao_iss,
        situacao_tributaria_pis_cofins: grupo.situacao_tributaria_pis_cofins,
        ...retencoesFederais,
        percentual_total_tributos_federais: String(grupo.pct_trib_federais ?? 0),
        percentual_total_tributos_estaduais: String(grupo.pct_trib_estaduais ?? 0),
        percentual_total_tributos_municipais: String(grupo.pct_trib_municipais ?? 0),
        ibs_cbs_situacao_tributaria: IBS_CBS_REFORMA.situacao_tributaria,
        ibs_cbs_classificacao_tributaria: IBS_CBS_REFORMA.classificacao_tributaria,
        codigo_indicador_operacao: IBS_CBS_REFORMA.indicador_operacao,
        ibs_uf_aliquota: IBS_CBS_REFORMA.ibs_uf_aliquota,
        ibs_mun_aliquota: IBS_CBS_REFORMA.ibs_mun_aliquota,
        cbs_aliquota: IBS_CBS_REFORMA.cbs_aliquota,
        ibs_uf_percentual_reducao: IBS_CBS_REFORMA.ibs_uf_percentual_reducao,
        ibs_mun_percentual_reducao: IBS_CBS_REFORMA.ibs_mun_percentual_reducao,
        cbs_percentual_reducao: IBS_CBS_REFORMA.cbs_percentual_reducao,
      }

      if (ensaio) {
        return {
          ok: true,
          ensaio: true,
          cliente_id: p.cliente_id,
          tomador_nome: tomador.nome,
          ref,
          nota_id: null,
          valor_total: valorTotal,
          valor_iss: valorIss,
          focus_status: "ensaio",
          focus_response: { descricao_servico: descricaoFinal, valor_servico: nfsePayload.valor_servico },
        }
      }

      const focusResp = await fetch(`${focusBase}/v2/nfsen?ref=${ref}`, {
        method: "POST",
        headers: { Authorization: `Basic ${btoa(focusToken + ":")}`, "Content-Type": "application/json" },
        body: JSON.stringify(nfsePayload),
      })
      const focusBody = await focusResp.json().catch(() => ({}))
      const accepted = focusResp.status >= 200 && focusResp.status < 300 && !(focusBody as any)?.codigo
      const focusStatus = accepted ? String((focusBody as any)?.status ?? "pendente") : "erro"

      const { data: noteId } = await supabase.rpc("insert_billing_note", {
        p_tenant_id: tenantId,
        p_contrato_id: contrato_id,
        // Guarda o caso na nota: e o que permite a composicao mostrar a nota
        // (e o boleto) na linha do caso certo.
        p_caso_id: escopoCaso,
        p_tipo_documento: "nota_fiscal_servico",
        p_status: accepted ? "gerado" : "cancelado",
        p_focus_ref: ref,
        p_focus_status: focusStatus,
        p_metadata: { focus_request: nfsePayload, focus_response: focusBody, item_ids: p.item_ids, pagador_cliente_id: p.cliente_id, valor_total: valorTotal, valor_iss: valorIss },
        p_created_by: user.id,
      })

      return { ok: accepted, cliente_id: p.cliente_id, tomador_nome: tomador.nome, ref, nota_id: noteId, valor_total: valorTotal, valor_iss: valorIss, focus_status: focusStatus, focus_response: focusBody }
    }

    // Emite sequencialmente (uma nota por pagador).
    const resultados: Array<Awaited<ReturnType<typeof emitirNota>>> = []
    for (const p of pagadores) {
      resultados.push(await emitirNota(p))
    }

    const aceitas = resultados.filter((r) => r.ok)
    const recusadas = resultados.filter((r) => !r.ok)

    // Nenhuma aceita → reverte o claim para permitir corrigir e reemitir do zero.
    if (aceitas.length === 0) {
      if (!ensaio) {
        await supabase.rpc("reverter_itens_faturamento", { p_user_id: user.id, p_tenant_id: tenantId, p_item_ids: allItemIds })
      }
      return json({ error: "Focus NFe recusou a emissão", notas: resultados }, 422)
    }

    // Aceitas + recusadas (raro, pós pré-validação): mantém os itens como
    // faturados (as notas aceitas são válidas) e sinaliza as recusadas para
    // tratamento manual — NÃO reverte, para não permitir re-emitir as aceitas.
    if (recusadas.length > 0) {
      return json({
        ok: false,
        partial: true,
        message: `${aceitas.length} nota(s) emitida(s), ${recusadas.length} recusada(s). Trate os pagadores recusados manualmente.`,
        aceitas, recusadas,
        // compat: campos da 1ª aceita
        ref: aceitas[0].ref, nota_id: aceitas[0].nota_id, valor_total: aceitas[0].valor_total, focus_status: aceitas[0].focus_status,
      }, 207)
    }

    // Todas aceitas.
    const valorSomado = aceitas.reduce((s, r) => s + Number(r.valor_total ?? 0), 0)
    return json({
      ok: true,
      n_notas: aceitas.length,
      notas: aceitas,
      valor_total_geral: valorSomado,
      // compat com o front atual (usa ref/valor_total/focus_status/nota_id da 1ª):
      ref: aceitas[0].ref, nota_id: aceitas[0].nota_id, valor_total: aceitas[0].valor_total, focus_status: aceitas[0].focus_status, focus_response: aceitas[0].focus_response,
    }, 200)
  } catch (error) {
    return json({ error: (error as Error).message }, 500)
  }
})
