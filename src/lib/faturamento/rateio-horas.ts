// Rateio / horas — relatório gerencial de horas lançadas x cobradas por mês de
// faturamento, com a divisão das horas COBRADAS por centro de custo (área de
// quem lançou). Os dados vêm de get_rateio_horas (uma linha por timesheet de
// caso por hora, já com a situação); aqui fica toda a conta que a tela mostra
// — filtros, totais, cut, colunas por centro de custo, linhas por caso — para
// poder ser testada sem banco. O volume é de centenas de linhas por mês.
//
// Indicador único: o CUT = 1 − cobradas ÷ lançadas. Hora em revisão (na fila,
// em revisão, em aprovação) ainda NÃO é cobrada, então entra no cut; por isso
// a tela mostra ao lado quanto ainda está em revisão e qual seria o cut se
// tudo isso fosse cobrado (cutSeCobrarRevisao), para o número não parecer
// pior do que vai ficar.
//
// Hora FORA DO FATURAMENTO (sem item e com contrato ou caso inativo: a fila
// não mostra e o gerador não fatura) não é corte — nunca foi ao faturamento.
// Fica à parte: não entra em lançadas, cobradas nem no cut; é somada só em
// foraFaturamento e aparece no detalhamento com essa situação.

import { normalizarCompetencia, somarMeses } from './competencia'

export type SituacaoRateio = 'cobrada' | 'cortada' | 'em_revisao' | 'fora_faturamento'

export type EtapaRateio =
  | 'na_fila'
  | 'em_revisao'
  | 'em_aprovacao'
  | 'aprovado'
  | 'faturado'
  | 'ignorado'
  | 'excluido_fila'
  | 'fora_da_fila'

export interface LancamentoRateio {
  timesheetId: string
  billingItemId: string | null
  dataLancamento: string
  descricao: string
  clienteId: string
  clienteNome: string
  contratoNumero: number | null
  casoId: string
  casoNumero: number | null
  casoNome: string
  usuarioId: string
  usuarioNome: string
  areaId: string | null
  areaNome: string | null
  horasLancadas: number
  horasCobradas: number
  etapa: EtapaRateio
  situacao: SituacaoRateio
}

/** Primeira aba: o relatório começa em agosto/2026 (pedido do cliente). */
export const PRIMEIRA_COMPETENCIA_RATEIO = '2026-08-01'

export const SEM_CENTRO_CUSTO = 'Sem centro de custo'
/** Chave do centro de custo de quem não tem área (não colide com uuid). */
export const CHAVE_SEM_CENTRO_CUSTO = 'sem-centro-de-custo'

export const ROTULO_SITUACAO: Record<SituacaoRateio, string> = {
  cobrada: 'Cobrada',
  cortada: 'Cortada',
  em_revisao: 'Em revisão',
  fora_faturamento: 'Fora do faturamento',
}

export const ROTULO_ETAPA: Record<EtapaRateio, string> = {
  na_fila: 'Na fila, aguardando liberação',
  em_revisao: 'Em revisão',
  em_aprovacao: 'Em aprovação',
  aprovado: 'Aprovado',
  faturado: 'Faturado',
  ignorado: 'Ignorado na revisão',
  excluido_fila: 'Excluído da fila (Lixeira)',
  fora_da_fila: 'Contrato ou caso inativo',
}

const ETAPAS = new Set<string>(Object.keys(ROTULO_ETAPA))
const SITUACOES = new Set<string>(Object.keys(ROTULO_SITUACAO))

function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function numOuNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v)
}

/** Lê o jsonb de get_rateio_horas; linha sem timesheet é descartada. */
export function lerLancamentosRateio(data: unknown): LancamentoRateio[] {
  if (!Array.isArray(data)) return []
  const out: LancamentoRateio[] = []
  for (const entry of data) {
    if (!entry || typeof entry !== 'object') continue
    const r = entry as Record<string, unknown>
    const timesheetId = str(r.timesheet_id)
    if (!timesheetId) continue
    const etapaRaw = str(r.etapa)
    const situacaoRaw = str(r.situacao)
    const areaId = str(r.area_id) || null
    out.push({
      timesheetId,
      billingItemId: str(r.billing_item_id) || null,
      dataLancamento: str(r.data_lancamento).slice(0, 10),
      descricao: str(r.descricao),
      clienteId: str(r.cliente_id),
      clienteNome: str(r.cliente_nome) || 'Sem cliente',
      contratoNumero: numOuNull(r.contrato_numero),
      casoId: str(r.caso_id),
      casoNumero: numOuNull(r.caso_numero),
      casoNome: str(r.caso_nome) || 'Sem nome',
      usuarioId: str(r.usuario_id),
      usuarioNome: str(r.usuario_nome) || 'Sem nome',
      areaId,
      areaNome: areaId ? str(r.area_nome) || SEM_CENTRO_CUSTO : null,
      horasLancadas: num(r.horas_lancadas),
      horasCobradas: num(r.horas_cobradas),
      etapa: (ETAPAS.has(etapaRaw) ? etapaRaw : 'em_revisao') as EtapaRateio,
      situacao: (SITUACOES.has(situacaoRaw) ? situacaoRaw : 'em_revisao') as SituacaoRateio,
    })
  }
  return out
}

export function chaveCentroCusto(l: Pick<LancamentoRateio, 'areaId'>): string {
  return l.areaId || CHAVE_SEM_CENTRO_CUSTO
}

export function nomeCentroCusto(l: Pick<LancamentoRateio, 'areaId' | 'areaNome'>): string {
  return l.areaId ? l.areaNome || SEM_CENTRO_CUSTO : SEM_CENTRO_CUSTO
}

// ---------------------------------------------------------------- filtros

export interface FiltrosRateio {
  /** usuario_id */
  usuario?: string
  /** chaveCentroCusto */
  centroCusto?: string
  /** cliente_id */
  cliente?: string
  /** caso_id */
  caso?: string
}

export function filtrarRateio(lancamentos: LancamentoRateio[], f: FiltrosRateio): LancamentoRateio[] {
  return lancamentos.filter(
    (l) =>
      (!f.usuario || l.usuarioId === f.usuario) &&
      (!f.centroCusto || chaveCentroCusto(l) === f.centroCusto) &&
      (!f.cliente || l.clienteId === f.cliente) &&
      (!f.caso || l.casoId === f.caso),
  )
}

export interface OpcaoFiltro {
  value: string
  label: string
}

const porLabel = (a: OpcaoFiltro, b: OpcaoFiltro) => a.label.localeCompare(b.label, 'pt-BR')

function unicas(lancamentos: LancamentoRateio[], par: (l: LancamentoRateio) => OpcaoFiltro): OpcaoFiltro[] {
  const mapa = new Map<string, OpcaoFiltro>()
  for (const l of lancamentos) {
    const o = par(l)
    if (o.value && !mapa.has(o.value)) mapa.set(o.value, o)
  }
  return Array.from(mapa.values()).sort(porLabel)
}

export function rotuloCaso(l: Pick<LancamentoRateio, 'casoNumero' | 'casoNome'>): string {
  return l.casoNumero !== null ? `${l.casoNumero} · ${l.casoNome}` : l.casoNome
}

/** Opções dos quatro filtros, do mês inteiro (sem filtro). O de caso
 *  respeita o cliente escolhido, como na Revisão. */
export function opcoesDosFiltros(lancamentos: LancamentoRateio[], clienteId?: string) {
  const centros = unicas(lancamentos, (l) => ({ value: chaveCentroCusto(l), label: nomeCentroCusto(l) }))
  // "Sem centro de custo" por último, como nas colunas.
  centros.sort((a, b) => Number(a.value === CHAVE_SEM_CENTRO_CUSTO) - Number(b.value === CHAVE_SEM_CENTRO_CUSTO))
  return {
    usuarios: unicas(lancamentos, (l) => ({ value: l.usuarioId, label: l.usuarioNome })),
    centrosCusto: centros,
    clientes: unicas(lancamentos, (l) => ({ value: l.clienteId, label: l.clienteNome })),
    casos: unicas(
      clienteId ? lancamentos.filter((l) => l.clienteId === clienteId) : lancamentos,
      (l) => ({ value: l.casoId, label: rotuloCaso(l) }),
    ),
  }
}

// ---------------------------------------------------------------- totais

export interface TotaisRateio {
  /** Sem as horas fora do faturamento. */
  lancadas: number
  cobradas: number
  /** Horas LANÇADAS de lançamentos ainda em revisão (podem virar cobradas). */
  emRevisao: number
  /** Lançamentos que entram em lançadas (sem os fora do faturamento). */
  lancamentos: number
  /** Horas lançadas fora do faturamento (contrato ou caso inativo): à parte,
   *  fora de lançadas, cobradas e cut. */
  foraFaturamento: number
  lancamentosForaFaturamento: number
}

export const totaisVazios = (): TotaisRateio => ({
  lancadas: 0,
  cobradas: 0,
  emRevisao: 0,
  lancamentos: 0,
  foraFaturamento: 0,
  lancamentosForaFaturamento: 0,
})

export const estaForaDoFaturamento = (l: Pick<LancamentoRateio, 'situacao'>) => l.situacao === 'fora_faturamento'

// Soma as horas como vêm do banco (mesma conta da Revisão e dos Indicadores)
// e só limpa o resíduo de ponto flutuante (0,1 + 0,2) ao fechar o total.
const limpar = (h: number) => Math.round(h * 1e6) / 1e6

function somar(acc: TotaisRateio, l: LancamentoRateio): TotaisRateio {
  if (estaForaDoFaturamento(l)) {
    acc.foraFaturamento += l.horasLancadas
    acc.lancamentosForaFaturamento += 1
    return acc
  }
  acc.lancadas += l.horasLancadas
  acc.cobradas += l.horasCobradas
  if (l.situacao === 'em_revisao') acc.emRevisao += l.horasLancadas
  acc.lancamentos += 1
  return acc
}

function fechar(t: TotaisRateio): TotaisRateio {
  return {
    ...t,
    lancadas: limpar(t.lancadas),
    cobradas: limpar(t.cobradas),
    emRevisao: limpar(t.emRevisao),
    foraFaturamento: limpar(t.foraFaturamento),
  }
}

export function totalizar(lancamentos: LancamentoRateio[]): TotaisRateio {
  return fechar(lancamentos.reduce(somar, totaisVazios()))
}

/** Cut = 1 − cobradas ÷ lançadas (fração; 0,345 = 34,5%). Sem lançadas: null.
 *  Pode ser negativo quando o aprovador cobra mais do que foi lançado. */
export function cut(t: Pick<TotaisRateio, 'lancadas' | 'cobradas'>): number | null {
  if (!(t.lancadas > 0)) return null
  return 1 - t.cobradas / t.lancadas
}

/** O cut se tudo o que está em revisão fosse cobrado integralmente: o piso
 *  para onde o cut ainda pode cair. Sem nada em revisão, é o próprio cut. */
export function cutSeCobrarRevisao(t: TotaisRateio): number | null {
  if (!(t.lancadas > 0)) return null
  return 1 - (t.cobradas + t.emRevisao) / t.lancadas
}

export function formatarCut(valor: number | null): string {
  if (valor === null) return '—'
  const pct = Math.round(valor * 1000) / 10
  return `${pct.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`
}

// ---------------------------------------------------------------- agregação

export interface CentroCustoRateio {
  chave: string
  nome: string
  totais: TotaisRateio
}

export interface CasoRateio {
  casoId: string
  casoNumero: number | null
  casoNome: string
  clienteId: string
  clienteNome: string
  contratoNumero: number | null
  /** As horas fora do faturamento ficam em totais.foraFaturamento, não em
   *  lançadas/cobradas. */
  totais: TotaisRateio
  /** chaveCentroCusto → totais do caso naquele centro de custo (só o que
   *  entra no faturamento). */
  porCentroCusto: Record<string, TotaisRateio>
  /** Todos, inclusive os fora do faturamento (o "ver +" mostra todos). */
  lancamentos: LancamentoRateio[]
}

export interface RelatorioRateio {
  totais: TotaisRateio
  /** Colunas da tabela e fatias da rosca: mais cobradas primeiro, "Sem
   *  centro de custo" por último. Só do que entra no faturamento: área que
   *  só tem hora fora do faturamento não vira coluna. */
  centrosCusto: CentroCustoRateio[]
  casos: CasoRateio[]
}

/** Monta o relatório dos lançamentos JÁ filtrados. */
export function montarRelatorio(lancamentos: LancamentoRateio[]): RelatorioRateio {
  const total = totaisVazios()
  const centros = new Map<string, { nome: string; totais: TotaisRateio }>()
  interface Acumulado {
    base: LancamentoRateio
    totais: TotaisRateio
    porCentroCusto: Map<string, TotaisRateio>
    lancamentos: LancamentoRateio[]
  }
  const casos = new Map<string, Acumulado>()

  for (const l of lancamentos) {
    somar(total, l)
    const caso: Acumulado = casos.get(l.casoId) ?? { base: l, totais: totaisVazios(), porCentroCusto: new Map(), lancamentos: [] }
    somar(caso.totais, l)
    caso.lancamentos.push(l)
    casos.set(l.casoId, caso)
    if (estaForaDoFaturamento(l)) continue

    const chave = chaveCentroCusto(l)
    const centro = centros.get(chave) ?? { nome: nomeCentroCusto(l), totais: totaisVazios() }
    somar(centro.totais, l)
    centros.set(chave, centro)
    const doCentro = caso.porCentroCusto.get(chave) ?? totaisVazios()
    somar(doCentro, l)
    caso.porCentroCusto.set(chave, doCentro)
  }

  const centrosCusto = Array.from(centros.entries())
    .map(([chave, c]) => ({ chave, nome: c.nome, totais: fechar(c.totais) }))
    .sort((a, b) => {
      const semA = a.chave === CHAVE_SEM_CENTRO_CUSTO
      const semB = b.chave === CHAVE_SEM_CENTRO_CUSTO
      if (semA !== semB) return semA ? 1 : -1
      return b.totais.cobradas - a.totais.cobradas || b.totais.lancadas - a.totais.lancadas || a.nome.localeCompare(b.nome, 'pt-BR')
    })

  const linhas: CasoRateio[] = Array.from(casos.values())
    .map((c) => ({
      casoId: c.base.casoId,
      casoNumero: c.base.casoNumero,
      casoNome: c.base.casoNome,
      clienteId: c.base.clienteId,
      clienteNome: c.base.clienteNome,
      contratoNumero: c.base.contratoNumero,
      totais: fechar(c.totais),
      porCentroCusto: Object.fromEntries(Array.from(c.porCentroCusto.entries()).map(([k, t]) => [k, fechar(t)])),
      lancamentos: [...c.lancamentos].sort(
        (a, b) => a.dataLancamento.localeCompare(b.dataLancamento) || a.usuarioNome.localeCompare(b.usuarioNome, 'pt-BR'),
      ),
    }))
    .sort(
      (a, b) =>
        a.clienteNome.localeCompare(b.clienteNome, 'pt-BR') ||
        (a.casoNumero ?? Number.MAX_SAFE_INTEGER) - (b.casoNumero ?? Number.MAX_SAFE_INTEGER) ||
        a.casoNome.localeCompare(b.casoNome, 'pt-BR'),
    )

  return { totais: fechar(total), centrosCusto, casos: linhas }
}

// ---------------------------------------------------------------- abas

/** Abas de competência: de agosto/2026 até o mês seguinte ao corrente (o
 *  que está sendo lançado agora), em ordem cronológica. */
export function competenciasDoRateio(atual: string): string[] {
  const fim = somarMeses(normalizarCompetencia(atual) ?? PRIMEIRA_COMPETENCIA_RATEIO, 1)
  const out: string[] = []
  for (let c = PRIMEIRA_COMPETENCIA_RATEIO; c <= fim; c = somarMeses(c, 1)) out.push(c)
  return out
}

/** Competência inicial: a pedida, se estiver nas abas; senão a mais recente
 *  que não seja futura. */
export function competenciaInicialDoRateio(pedida: string | null | undefined, atual: string): string {
  const abas = competenciasDoRateio(atual)
  const comp = normalizarCompetencia(pedida)
  if (comp && abas.includes(comp)) return comp
  const atualNorm = normalizarCompetencia(atual) ?? PRIMEIRA_COMPETENCIA_RATEIO
  return abas.filter((c) => c <= atualNorm).pop() ?? abas[0]
}
