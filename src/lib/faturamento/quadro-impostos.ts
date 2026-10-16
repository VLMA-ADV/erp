// Quadro "Impostos" por pagador (cliente, out/2026): bruto da parte de cada
// pagador, cada retenção e o líquido. Sai no PDF do relatório de timesheet e
// na prévia da NFS-e.
//
// Fonte de cada linha:
//  - NFS-e do pagador já emitida → valores REAIS da nota (o que foi enviado à
//    prefeitura em billing_notes.metadata.focus_request; líquido por
//    finance.valor_liquido_da_nota, conferido contra o <vLiq> do XML);
//  - ainda não emitida → ESTIMADO pela mesma conta da emissão
//    (impostos-nfse.ts), marcado como "estimado";
//  - sem grupo de impostos no cadastro → não há como estimar (a emissão nem
//    sai sem grupo): bruto = líquido, marcado "sem grupo de impostos".

import {
  calcularImpostosPorPagador,
  type ConfigGrupoImposto,
  type ImpostosNfse,
} from './impostos-nfse'

export type OrigemQuadro = 'emitida' | 'estimado' | 'sem_grupo'

export interface RetencoesQuadro {
  irrf: number
  pis: number
  cofins: number
  csll: number
  inss: number
  iss: number
}

export interface QuadroImpostosPagador {
  cliente_id: string | null
  nome: string
  /** Percentual do rateio; null quando a nota não está no rateio do kit. */
  percentual: number | null
  bruto: number
  retencoes: RetencoesQuadro
  liquido: number
  origem: OrigemQuadro
  /** Número da NFS-e quando emitida (pode faltar até a prefeitura autorizar). */
  nfseNumero?: string | null
}

/** Uma NFS-e emitida como a RPC get_quadro_impostos_kit devolve. */
export interface NotaEmitidaRetencoes {
  nota_id: string
  pagador_cliente_id: string | null
  pagador_nome?: string | null
  nfse_numero: string | null
  valor_total: number | string | null
  valor_irrf: number | string | null
  valor_pis: number | string | null
  valor_cofins: number | string | null
  /** Retenção unificada PIS+COFINS+CSLL (o `valor_csll` do pedido à prefeitura). */
  valor_pis_cofins_csll: number | string | null
  valor_inss: number | string | null
  valor_iss_retido: number | string | null
  valor_liquido: number | string | null
}

const n = (v: unknown) => {
  const x = Number(v ?? 0)
  return Number.isFinite(x) ? x : 0
}
const centavos = (v: number) => Math.round(v * 100) / 100

export const COLUNAS_RETENCAO: Array<{ chave: keyof RetencoesQuadro; rotulo: string }> = [
  { chave: 'irrf', rotulo: 'IRRF' },
  { chave: 'pis', rotulo: 'PIS' },
  { chave: 'cofins', rotulo: 'COFINS' },
  { chave: 'csll', rotulo: 'CSLL' },
  { chave: 'inss', rotulo: 'INSS' },
  { chave: 'iss', rotulo: 'ISS retido' },
]

/**
 * Colunas que o quadro mostra: só os impostos com valor em pelo menos um
 * pagador. Sem retenção nenhuma, lista vazia — o quadro fica bruto → líquido.
 */
export function colunasComValor(linhas: QuadroImpostosPagador[]): Array<{ chave: keyof RetencoesQuadro; rotulo: string }> {
  return COLUNAS_RETENCAO.filter((c) => linhas.some((l) => l.retencoes[c.chave] > 0.004))
}

export function retencoesDaConta(i: ImpostosNfse): RetencoesQuadro {
  return { irrf: i.irrf.valor, pis: i.pis.valor, cofins: i.cofins.valor, csll: i.csll.valor, inss: i.inss, iss: i.issRetido }
}

/** Valores reais de uma nota emitida. CSLL = unificada − PIS − COFINS. */
export function retencoesDaNota(nota: NotaEmitidaRetencoes): { bruto: number; retencoes: RetencoesQuadro; liquido: number } {
  const pis = n(nota.valor_pis)
  const cofins = n(nota.valor_cofins)
  const unificada = nota.valor_pis_cofins_csll == null ? pis + cofins : n(nota.valor_pis_cofins_csll)
  const bruto = n(nota.valor_total)
  const retencoes: RetencoesQuadro = {
    irrf: n(nota.valor_irrf),
    pis,
    cofins,
    csll: Math.max(0, centavos(unificada - pis - cofins)),
    inss: n(nota.valor_inss),
    iss: n(nota.valor_iss_retido),
  }
  const liquido = nota.valor_liquido == null
    ? centavos(bruto - retencoes.irrf - unificada - retencoes.inss - retencoes.iss)
    : n(nota.valor_liquido)
  return { bruto, retencoes, liquido }
}

const ZERO: RetencoesQuadro = { irrf: 0, pis: 0, cofins: 0, csll: 0, inss: 0, iss: 0 }

export interface EntradaQuadro {
  /** Pagadores do kit na ordem de emissão (rateio). Vazio = cliente do contrato a 100%. */
  pagadores: Array<{ cliente_id: string | null; nome: string | null; percentual: number }>
  /** Valor de serviço do kit — o bruto da(s) NFS-e. */
  valorServico: number
  /** Grupo de impostos resolvido; null = sem grupo no cadastro. */
  grupo: ConfigGrupoImposto | null
  /** get_client_month_accumulated_value de cada pagador ainda sem nota. */
  acumuladoAtual: Record<string, number>
  contratoClienteId: string | null
  /** NFS-e vivas do kit. */
  notas: NotaEmitidaRetencoes[]
  /** Nome usado quando o pagador vem sem nome (ou não há pagador). */
  nomePadrao: string
}

/**
 * Uma linha por pagador. Quem já tem NFS-e sai com os valores da nota; os
 * demais, estimados com a conta da emissão (cada um com o seu acumulado, e o
 * cliente do contrato somando as notas que saem antes dele na mesma emissão).
 * Nota emitida para alguém fora do rateio do kit (pagador trocado na hora de
 * emitir) entra também — é o que o cliente vai receber.
 */
export function montarQuadroImpostos(e: EntradaQuadro): QuadroImpostosPagador[] {
  const pagadores = e.pagadores.length > 0
    ? e.pagadores
    : [{ cliente_id: e.contratoClienteId, nome: e.nomePadrao, percentual: 100 }]
  const notaPorPagador = new Map<string, NotaEmitidaRetencoes>()
  for (const nota of e.notas) if (nota.pagador_cliente_id) notaPorPagador.set(nota.pagador_cliente_id, nota)
  // Kit sem rateio com nota antiga sem pagador gravado: a nota é do único pagador.
  const notaSemPagador = e.notas.find((x) => !x.pagador_cliente_id) ?? null

  const semNota = pagadores.filter((p) => !(p.cliente_id && notaPorPagador.has(p.cliente_id)) && !(pagadores.length === 1 && notaSemPagador))
  const estimados = e.grupo
    ? calcularImpostosPorPagador({
        grupo: e.grupo,
        pagadores: semNota.map((p) => ({
          cliente_id: p.cliente_id ?? '',
          valor: Math.round(e.valorServico * Number(p.percentual || 0) / 100 * 100) / 100,
        })),
        acumuladoAtual: e.acumuladoAtual,
        contratoClienteId: e.contratoClienteId,
      })
    : null

  const linhas: QuadroImpostosPagador[] = pagadores.map((p) => {
    const nome = p.nome?.trim() || e.nomePadrao
    const percentual = Number(p.percentual || 0)
    const nota = (p.cliente_id && notaPorPagador.get(p.cliente_id)) || (pagadores.length === 1 ? notaSemPagador : null)
    if (nota) {
      const real = retencoesDaNota(nota)
      return { cliente_id: p.cliente_id, nome, percentual, ...real, origem: 'emitida', nfseNumero: nota.nfse_numero }
    }
    const i = semNota.indexOf(p)
    const bruto = Math.round(e.valorServico * percentual / 100 * 100) / 100
    if (!estimados) return { cliente_id: p.cliente_id, nome, percentual, bruto, retencoes: { ...ZERO }, liquido: bruto, origem: 'sem_grupo' }
    const conta = estimados[i].impostos
    return { cliente_id: p.cliente_id, nome, percentual, bruto, retencoes: retencoesDaConta(conta), liquido: conta.valorLiquido, origem: 'estimado' }
  })

  const noRateio = new Set(pagadores.map((p) => p.cliente_id).filter(Boolean))
  for (const nota of e.notas) {
    if (!nota.pagador_cliente_id || noRateio.has(nota.pagador_cliente_id)) continue
    linhas.push({ cliente_id: nota.pagador_cliente_id, nome: nota.pagador_nome?.trim() || e.nomePadrao, percentual: null, ...retencoesDaNota(nota), origem: 'emitida', nfseNumero: nota.nfse_numero })
  }
  return linhas
}
