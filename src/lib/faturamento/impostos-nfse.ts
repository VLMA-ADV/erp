// Conta das retenções da NFS-e (IRRF, PIS, COFINS, CSLL, INSS, ISS retido) e
// do líquido. Antes vivia dentro da nfse-preview-dialog e a edge emit-nfse
// (supabase/functions/emit-nfse/index.ts, emitirNota) repetia a mesma conta à
// mão. Este módulo é a versão do front: função pura, sem Supabase, para a
// prévia e o relatório de timesheet usarem a MESMA conta. Mudou a regra aqui,
// muda na edge também (Deno não importa de src/).
//
// Regra (contador Guilherme, WhatsApp 21/05 16:24; Filipe, call 20/05):
//   COFINS 3,00% (mínimo cálculo R$ 215,34, mínimo retenção R$ 6,46)
//   CSLL   1,00% (mínimo cálculo R$ 215,34, mínimo retenção R$ 2,15)
//   PIS    0,65% (mínimo cálculo R$ 215,34, mínimo retenção R$ 1,40)
//   IRRF   1,50% (mínimo cálculo R$ 666,67, mínimo retenção R$ 10,00)
// Sem INSS — confirmado pelo contador que a VLMA não retém INSS na fonte.
// O mínimo de cálculo compara (bruto + acumulado do mês do tomador); o mínimo
// de retenção compara o imposto DESTA nota.

export const ALIQUOTAS_VOA_LEGAL = {
  iss: { aliquota: 3.5, label: 'ISS' }, // municipal Curitiba, fiscal real
  irrf: { aliquota: 1.5, minCalc: 666.67, minRet: 10, label: 'IRRF' },
  pis: { aliquota: 0.65, minCalc: 215.34, minRet: 1.4, label: 'PIS' },
  cofins: { aliquota: 3, minCalc: 215.34, minRet: 6.46, label: 'COFINS' },
  csll: { aliquota: 1, minCalc: 215.34, minRet: 2.15, label: 'CSLL' },
} as const

// 7 Grupos de impostos da VLMA (mensagem contador 21/05 16:24 + decisão Filipe na call 20/05):
export type GrupoImpostoNome =
  | 'PJ Nacional' | 'PF Nacional' | 'Estrangeiro' | 'IRRF' | 'PJ sem mínimo' | 'IRRF sem mínimo' | 'Sem IRRF'

interface RegraGrupo {
  retem: { irrf: boolean; pis: boolean; cofins: boolean; csll: boolean }
  respeitaMinimo: boolean
  observacao: string
}

/** Fallback por nome, para grupo antigo sem as colunas retem_* / aliquota_* / min_*. */
export const REGRAS_GRUPOS: Record<GrupoImpostoNome, RegraGrupo> = {
  'PJ Nacional': {
    retem: { irrf: true, pis: true, cofins: true, csll: true },
    respeitaMinimo: true,
    observacao: 'Retenção dos 4 impostos respeitando valor mínimo',
  },
  'PF Nacional': {
    retem: { irrf: false, pis: false, cofins: false, csll: false },
    respeitaMinimo: false,
    observacao: 'Sem retenções',
  },
  Estrangeiro: {
    retem: { irrf: false, pis: false, cofins: false, csll: false },
    respeitaMinimo: false,
    observacao: 'Sem retenções',
  },
  IRRF: {
    retem: { irrf: true, pis: false, cofins: false, csll: false },
    respeitaMinimo: true,
    observacao: 'Apenas IRRF, respeitando valor mínimo',
  },
  'PJ sem mínimo': {
    retem: { irrf: true, pis: true, cofins: true, csll: true },
    respeitaMinimo: false,
    observacao: 'Retenção dos 4 impostos, independente de valor',
  },
  'IRRF sem mínimo': {
    retem: { irrf: true, pis: false, cofins: false, csll: false },
    respeitaMinimo: false,
    observacao: 'Apenas IRRF, independente de valor',
  },
  'Sem IRRF': {
    retem: { irrf: false, pis: true, cofins: true, csll: true },
    respeitaMinimo: true,
    observacao: 'COFINS + CSLL + PIS (sem IRRF)',
  },
}

/** Linha de contracts.grupos_impostos como chega das RPCs (to_jsonb). */
export interface GrupoImpostoDb {
  id?: string | null
  nome?: string | null
  descricao?: string | null
  retem_irrf?: boolean | null
  retem_pis?: boolean | null
  retem_cofins?: boolean | null
  retem_csll?: boolean | null
  respeita_minimo?: boolean | null
  aliquota_irrf?: number | string | null
  aliquota_pis?: number | string | null
  aliquota_cofins?: number | string | null
  aliquota_csll?: number | string | null
  aliquota_iss?: number | string | null
  min_calc_irrf?: number | string | null
  min_calc_pis_cofins_csll?: number | string | null
  min_ret_irrf?: number | string | null
  min_ret_pis?: number | string | null
  min_ret_cofins?: number | string | null
  min_ret_csll?: number | string | null
  /** 1 = ISS não retido; 2/3 = retido pelo tomador/intermediário. */
  tipo_retencao_iss?: number | string | null
  [k: string]: unknown
}

export type Imposto = 'irrf' | 'pis' | 'cofins' | 'csll'

/** Regras já resolvidas (banco com fallback) — o que a conta usa. */
export interface ConfigGrupoImposto {
  /** Nome que vale para a regra (o do banco quando ele está em REGRAS_GRUPOS; senão o fallback). */
  nome: GrupoImpostoNome
  /** Nome como está no cadastro, se houver. */
  nomeCadastro: string | null
  observacao: string
  retem: Record<Imposto, boolean>
  respeitaMinimo: boolean
  aliquota: Record<Imposto, number> & { iss: number }
  minCalc: { irrf: number; pisCofinsCsll: number }
  minRet: Record<Imposto, number>
  tipoRetencaoIss: number
}

const num = (v: unknown, padrao: number): number => {
  if (v === null || v === undefined || v === '') return padrao
  const n = Number(v)
  return Number.isFinite(n) ? n : padrao
}

/**
 * Preferência: colunas do banco (retem_* + aliquota_* + min_*). Fallback:
 * REGRAS_GRUPOS por nome (grupo antigo sem colunas); sem nome conhecido, pelo
 * tipo do tomador (PF → 'PF Nacional', senão 'PJ Nacional').
 */
export function resolverGrupoImposto(
  grupoDb: GrupoImpostoDb | null | undefined,
  tipoTomador: 'PF' | 'PJ' | null,
): ConfigGrupoImposto {
  const nomeCadastro = (grupoDb?.nome as string | undefined) || null
  const nome: GrupoImpostoNome = nomeCadastro && REGRAS_GRUPOS[nomeCadastro as GrupoImpostoNome]
    ? (nomeCadastro as GrupoImpostoNome)
    : tipoTomador === 'PF' ? 'PF Nacional' : 'PJ Nacional'
  const regra = REGRAS_GRUPOS[nome]
  const A = ALIQUOTAS_VOA_LEGAL
  return {
    nome,
    nomeCadastro,
    observacao: (grupoDb?.descricao as string | undefined) || regra.observacao,
    retem: {
      irrf: grupoDb?.retem_irrf ?? regra.retem.irrf,
      pis: grupoDb?.retem_pis ?? regra.retem.pis,
      cofins: grupoDb?.retem_cofins ?? regra.retem.cofins,
      csll: grupoDb?.retem_csll ?? regra.retem.csll,
    },
    respeitaMinimo: grupoDb?.respeita_minimo ?? regra.respeitaMinimo,
    aliquota: {
      irrf: num(grupoDb?.aliquota_irrf, A.irrf.aliquota),
      pis: num(grupoDb?.aliquota_pis, A.pis.aliquota),
      cofins: num(grupoDb?.aliquota_cofins, A.cofins.aliquota),
      csll: num(grupoDb?.aliquota_csll, A.csll.aliquota),
      iss: num(grupoDb?.aliquota_iss, A.iss.aliquota),
    },
    minCalc: {
      irrf: num(grupoDb?.min_calc_irrf, A.irrf.minCalc),
      pisCofinsCsll: num(grupoDb?.min_calc_pis_cofins_csll, A.pis.minCalc),
    },
    minRet: {
      irrf: num(grupoDb?.min_ret_irrf, A.irrf.minRet),
      pis: num(grupoDb?.min_ret_pis, A.pis.minRet),
      cofins: num(grupoDb?.min_ret_cofins, A.cofins.minRet),
      csll: num(grupoDb?.min_ret_csll, A.csll.minRet),
    },
    tipoRetencaoIss: num(grupoDb?.tipo_retencao_iss, 1),
  }
}

/** Por que a retenção saiu (ou não) — a tela monta o texto. */
export type MotivoRetencao =
  | { tipo: 'nao_aplica' }
  | { tipo: 'base_abaixo_minimo'; base: number; minCalc: number; comAcumulado: boolean }
  | { tipo: 'retencao_abaixo_minimo'; minRet: number }
  | { tipo: 'por_acumulacao'; acumulado: number; bruto: number; base: number }

export interface Retencao {
  valor: number
  aplicado: boolean
  aliquota: number
  motivo?: MotivoRetencao
}

export interface ImpostosNfse {
  valorBruto: number
  acumuladoMes: number
  /** bruto + acumulado — o que se compara com o mínimo de cálculo. */
  baseCalculoMinimo: number
  irrf: Retencao
  pis: Retencao
  cofins: Retencao
  csll: Retencao
  /**
   * Retenção unificada PIS+COFINS+CSLL. É o que a edge manda em `valor_csll`
   * e o que finance.valor_liquido_da_nota desconta.
   */
  pisCofinsCsll: number
  inss: number
  /** ISS que o tomador retém (tipo_retencao_iss 2/3). Com 1, zero. */
  issRetido: number
  totalRetencoes: number
  valorLiquido: number
}

const centavos = (v: number) => Math.round(v * 100) / 100

export interface EntradaImpostos {
  grupo: ConfigGrupoImposto
  valorBruto: number
  /** Soma das NFS-e do tomador já emitidas no mês (get_client_month_accumulated_value). */
  acumuladoMes: number
}

/** A conta, igual à de emit-nfse (emitirNota → calcRet). */
export function calcularImpostosNfse({ grupo, valorBruto, acumuladoMes }: EntradaImpostos): ImpostosNfse {
  const bruto = Number(valorBruto || 0)
  const acumulado = Number(acumuladoMes || 0)
  const base = bruto + acumulado

  const reter = (imp: Imposto): Retencao => {
    const aliquota = grupo.aliquota[imp]
    if (!grupo.retem[imp]) return { valor: 0, aplicado: false, aliquota, motivo: { tipo: 'nao_aplica' } }
    const minCalc = imp === 'irrf' ? grupo.minCalc.irrf : grupo.minCalc.pisCofinsCsll
    const minRet = grupo.minRet[imp]
    if (grupo.respeitaMinimo && base < minCalc) {
      return { valor: 0, aplicado: false, aliquota, motivo: { tipo: 'base_abaixo_minimo', base, minCalc, comAcumulado: acumulado > 0 } }
    }
    const valor = Math.round(bruto * aliquota) / 100
    if (grupo.respeitaMinimo && valor < minRet) {
      return { valor: 0, aplicado: false, aliquota, motivo: { tipo: 'retencao_abaixo_minimo', minRet } }
    }
    const porAcumulacao = acumulado > 0 && bruto < minCalc
    return {
      valor,
      aplicado: true,
      aliquota,
      ...(porAcumulacao ? { motivo: { tipo: 'por_acumulacao' as const, acumulado, bruto, base } } : {}),
    }
  }

  const irrf = reter('irrf')
  const pis = reter('pis')
  const cofins = reter('cofins')
  const csll = reter('csll')
  const pisCofinsCsll = centavos(pis.valor + cofins.valor + csll.valor)
  const inss = 0
  // Mesmo arredondamento da edge: valor_iss = round(round(bruto × alíq × 100) / 10000, 2).
  const valorIss = centavos(Math.round(bruto * grupo.aliquota.iss * 100) / 10000)
  const issRetido = grupo.tipoRetencaoIss === 2 || grupo.tipoRetencaoIss === 3 ? valorIss : 0
  const totalRetencoes = centavos(irrf.valor + pisCofinsCsll + inss + issRetido)
  const valorLiquido = Math.max(0, centavos(bruto - totalRetencoes))

  return {
    valorBruto: bruto,
    acumuladoMes: acumulado,
    baseCalculoMinimo: base,
    irrf, pis, cofins, csll,
    pisCofinsCsll,
    inss,
    issRetido,
    totalRetencoes,
    valorLiquido,
  }
}

// ── Por pagador, como a emissão faz ──────────────────────────────────────
// A emit-nfse emite UMA nota por pagador (rateio) e faz a conta acima para
// cada uma, com o valor DELE e o acumulado DELE. A prévia fazia uma conta só,
// sobre o total e com o acumulado do cliente do contrato — com rateio, o
// mínimo de cálculo era comparado ao total (R$ 1.000 em 50/50 mostrava IRRF de
// R$ 15,00; as duas notas de R$ 500 saem sem IRRF).

export interface PagadorDaNota {
  cliente_id: string
  /** Valor bruto da nota deste pagador. */
  valor: number
}

export interface AjustesPagadores {
  pagadores?: Array<{ cliente_id: string; percentual: number }>
  valor_total?: number
}

/**
 * Pagadores e valores de cada nota, montados como a emit-nfse monta: a lista
 * do ajuste substitui o rateio do cadastro (valor = total × %); só o valor
 * ajustado reescala o rateio; sem ajuste, o que veio de
 * get_billing_items_aprovados_escopo. A ordem é a de emissão.
 */
export function pagadoresDaEmissao(
  doEscopo: Array<{ cliente_id: string; valor_total: number | string | null }>,
  ajustes?: AjustesPagadores | null,
): PagadorDaNota[] {
  const original = doEscopo.reduce((s, p) => s + Number(p.valor_total ?? 0), 0)
  const valorDaNota = typeof ajustes?.valor_total === 'number' && ajustes.valor_total > 0 ? ajustes.valor_total : original
  if (ajustes?.pagadores && ajustes.pagadores.length > 0) {
    return ajustes.pagadores.map((p) => ({
      cliente_id: p.cliente_id,
      valor: Math.round(valorDaNota * Number(p.percentual) / 100 * 100) / 100,
    }))
  }
  if (valorDaNota !== original && original > 0) {
    return doEscopo.map((p) => ({
      cliente_id: p.cliente_id,
      valor: Math.round(Number(p.valor_total ?? 0) * (valorDaNota / original) * 100) / 100,
    }))
  }
  return doEscopo.map((p) => ({ cliente_id: p.cliente_id, valor: Number(p.valor_total ?? 0) }))
}

/**
 * 'YYYY-MM' que a emit-nfse passa a get_client_month_accumulated_value: a
 * data de emissão em horário de Brasília (isoBrt(60) → data_competencia). Não
 * é a competência do kit.
 */
export function mesDaEmissao(agora: Date = new Date()): string {
  return new Date(agora.getTime() - 60_000 - 3 * 60 * 60 * 1000).toISOString().slice(0, 7)
}

/**
 * Acumulado que cada pagador terá NO MOMENTO da sua nota. A emit-nfse chama
 * get_client_month_accumulated_value(pagador) antes de cada nota, e essa
 * função soma as NFS-e do mês pelo TOMADOR da nota (metadata.pagador_cliente_id;
 * nota antiga sem o campo, cliente do contrato) — migration 20261021110000.
 * Até ela, somava pelo cliente do contrato, e a prévia copiava isso de
 * propósito. Consequência agora: as notas que esta mesma emissão já soltou
 * entram só no acumulado do próprio pagador de cada uma.
 */
export function acumuladosNaEmissao(
  pagadores: PagadorDaNota[],
  acumuladoAtual: Record<string, number>,
): number[] {
  const jaEmitidoNestaEmissao = new Map<string, number>()
  return pagadores.map((p) => {
    const acumulado = Number(acumuladoAtual[p.cliente_id] ?? 0) + (jaEmitidoNestaEmissao.get(p.cliente_id) ?? 0)
    jaEmitidoNestaEmissao.set(p.cliente_id, (jaEmitidoNestaEmissao.get(p.cliente_id) ?? 0) + p.valor)
    return acumulado
  })
}

export interface ImpostosDoPagador extends PagadorDaNota {
  acumuladoMes: number
  impostos: ImpostosNfse
}

/** Uma conta por nota, cada uma com o seu acumulado. */
export function calcularImpostosPorPagador(args: {
  grupo: ConfigGrupoImposto
  pagadores: PagadorDaNota[]
  acumuladoAtual: Record<string, number>
}): ImpostosDoPagador[] {
  const acumulados = acumuladosNaEmissao(args.pagadores, args.acumuladoAtual)
  return args.pagadores.map((p, i) => ({
    ...p,
    acumuladoMes: acumulados[i],
    impostos: calcularImpostosNfse({ grupo: args.grupo, valorBruto: p.valor, acumuladoMes: acumulados[i] }),
  }))
}
