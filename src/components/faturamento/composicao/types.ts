// Tipos e utilidades da Composição da fatura (lote C).
//
// Espelham o JSON de public.get_composicao_fatura (migração
// 20260923100000_composicao_kit_por_caso.sql). O kit é (caso, competência);
// item sem caso agrupa num bloco "Sem caso" por contrato. Quem muda o
// contrato da RPC muda aqui — não há geração automática de tipos.

// 'finalizado' entrou em 25/09 (Filipe, 24/09): o e-mail ainda sai manual
// pelo Gmail, então "Finalizar faturamento" é a baixa manual do kit. Na RPC
// ele tem prioridade sobre pendente/nf_emitida/enviado; recebido fica acima.
export type StatusKit = 'pendente' | 'nf_emitida' | 'enviado' | 'finalizado' | 'recebido'

export const STATUS_KIT_ORDEM: StatusKit[] = ['pendente', 'nf_emitida', 'enviado', 'finalizado', 'recebido']

// Cores pedidas pelo Filipe (21/09): pendente âmbar, NF emitida azul, enviado
// verde, recebido esmeralda escuro; falha de envio em vermelho. Finalizado
// (24/09) em verde escuro, para não confundir com "enviado".
export const STATUS_KIT_INFO: Record<StatusKit, {
  label: string
  badge: string
  card: string
  cardAtivo: string
  /** Borda esquerda do bloco do caso. */
  borda: string
  /** Borda do cartão do cliente (classe inteira, para o Tailwind enxergar). */
  bordaCard: string
}> = {
  pendente: {
    label: 'Pendente',
    badge: 'border-amber-200 bg-amber-50 text-amber-800',
    card: 'border-amber-200 bg-amber-50/60 hover:bg-amber-50',
    cardAtivo: 'border-amber-500 bg-amber-100 ring-2 ring-amber-300',
    borda: 'border-l-amber-400',
    bordaCard: 'border-amber-300',
  },
  nf_emitida: {
    label: 'NF emitida',
    badge: 'border-blue-200 bg-blue-50 text-blue-800',
    card: 'border-blue-200 bg-blue-50/60 hover:bg-blue-50',
    cardAtivo: 'border-blue-500 bg-blue-100 ring-2 ring-blue-300',
    borda: 'border-l-blue-400',
    bordaCard: 'border-blue-300',
  },
  enviado: {
    label: 'Enviado',
    badge: 'border-green-200 bg-green-50 text-green-800',
    card: 'border-green-200 bg-green-50/60 hover:bg-green-50',
    cardAtivo: 'border-green-500 bg-green-100 ring-2 ring-green-300',
    borda: 'border-l-green-500',
    bordaCard: 'border-green-300',
  },
  finalizado: {
    label: 'Finalizado',
    badge: 'border-green-700 bg-green-700 text-white',
    card: 'border-green-700 bg-green-50/60 hover:bg-green-50',
    cardAtivo: 'border-green-800 bg-green-100 ring-2 ring-green-500',
    borda: 'border-l-green-800',
    bordaCard: 'border-green-700',
  },
  recebido: {
    label: 'Recebido',
    badge: 'border-emerald-300 bg-emerald-100 text-emerald-900',
    card: 'border-emerald-300 bg-emerald-50/60 hover:bg-emerald-50',
    cardAtivo: 'border-emerald-700 bg-emerald-100 ring-2 ring-emerald-400',
    borda: 'border-l-emerald-700',
    bordaCard: 'border-emerald-600',
  },
}

export interface LinhaTimesheet {
  data: string | null
  profissional: string | null
  cargo: string | null
  descricao: string | null
  horas: number
  valor_hora: number
  valor: number
  /**
   * Foto do profissional como está em people.colaboradores.foto_url (path no
   * bucket privado `colaboradores-fotos` ou URL pública antiga). Opcional:
   * a RPC get_composicao_fatura ainda não devolve; quando devolver, o
   * relatório de timesheet passa a sair com o avatar sem mais mudança no front.
   */
  foto_url?: string | null
}

export interface DespesaItem {
  data: string | null
  categoria: string | null
  descricao: string | null
  valor: number
}

export interface ItemKit {
  id: string
  origem_tipo: string
  descricao: string
  data_referencia: string | null
  horas: number
  valor: number
  status: 'aprovado' | 'faturado' | string
  linhas_timesheet: LinhaTimesheet[]
  despesa: DespesaItem | null
}

export interface DocNfse {
  id: string
  numero: number | null
  nfse_numero: string | null
  status: 'gerado' | 'cancelado' | string
  focus_status: string | null
  arquivo_nome: string | null
  arquivo_url: string | null
  valor_total: number | null
  created_at: string
}

export interface DocBoleto {
  id: string
  status: string
  vencimento: string | null
  valor: number
  linha_digitavel: string | null
  nosso_numero: string | null
  pix_emv: string | null
}

export interface DocGerado {
  id: string
  gerado_em: string
  gerado_por: string | null
  arquivo_nome: string | null
  /** Path no bucket faturamento-documentos (assinar antes de abrir). */
  arquivo_url: string | null
}

/**
 * Nota de débito do kit. Desde 07/10 (Filipe, Elizir caso 360: kit só de
 * despesas não tinha como emitir boleto) um kit SEM serviço ganha conta a
 * receber própria ao registrar a nota de débito — `lancamento_id` aponta
 * para ela. Kit com serviço continua sem (as despesas vão no boleto da NFS-e).
 * Opcional: RPC antiga não devolve e a tela se comporta como antes.
 */
export interface DocNotaDebito extends DocGerado {
  lancamento_id?: string | null
}

/** Sobre qual documento o boleto do kit é emitido (RPC, 07/10). */
export type BoletoBase = 'nfse' | 'nota_debito'

export interface EnvioKit {
  enviado_em: string
  destinatario: string
  por: string | null
  erro: string | null
  total: number
}

export interface ContaReceberKit {
  id: string
  status: string
  valor: number
  vencimento: string | null
  pago_em: string | null
}

export interface Pagador {
  cliente_id: string
  nome: string | null
  percentual: number
}

/** Baixa manual do kit (finalizar_kit). */
export interface FinalizadoKit {
  em: string
  por_nome: string | null
  obs: string | null
}

/**
 * Impostos/pagadores que valem SÓ para este kit (finance.kits.ajustes). Quando
 * existe, `grupo_imposto` e `pagadores` do caso já vêm refletindo o ajuste e
 * `ajustes_do_kit` é true — a tela mostra o badge "ajustado neste kit".
 */
export interface AjustesKit {
  grupo_imposto_id: string | null
  grupo_imposto_nome: string | null
  pagadores: Pagador[] | null
}

export interface KitCaso {
  chave: string
  caso_id: string | null
  caso_numero: number | null
  caso_nome: string
  regra_cobranca: string | null
  contrato_id: string
  contrato_numero: number | null
  contrato_nome: string | null
  /** 'YYYY-MM-01' */
  competencia: string
  enviar_relatorio_timesheet: boolean
  grupo_imposto: { id: string; nome: string } | null
  pagadores: Pagador[]
  valor_servico: number
  valor_despesa: number
  /** Soma de TODOS os itens de timesheet do kit, inclusive os de valor 0 (mensal/projeto). */
  horas: number
  /** Contagem de lançamentos de timesheet do kit. */
  lancamentos_timesheet: number
  valor_total: number
  itens: ItemKit[]
  documentos: {
    nfse: DocNfse | null
    boleto: DocBoleto | null
    relatorio_timesheet: DocGerado | null
    nota_debito: DocNotaDebito | null
  }
  envio: EnvioKit | null
  /** Lançamento a receber do kit: o da NFS-e ou, sem NFS-e, o da nota de débito (ver boleto_base). */
  conta_receber: ContaReceberKit | null
  status_kit: StatusKit
  finalizado: FinalizadoKit | null
  ajustes_kit: AjustesKit | null
  ajustes_do_kit?: boolean
  pode_excluir: boolean
  motivo_bloqueio: string | null
  /**
   * Documento que sustenta o boleto: 'nfse' quando há conta a receber da
   * NFS-e, 'nota_debito' quando o kit é só de despesas e a nota de débito
   * criou a conta própria, null quando ainda não há sobre o que emitir.
   * Ausente (RPC antiga) = comportamento anterior, só pela NFS-e.
   */
  boleto_base?: BoletoBase | null
  /**
   * Quantos kits do mesmo contrato+competência ainda têm serviço a faturar e
   * nenhuma NFS-e viva (este incluído). ≥ 2 habilita "Emitir nota única" no
   * cabeçalho do cliente (Filipe 07/10, Charles Sturmer casos 1873 e 1877).
   */
  irmaos_no_contrato?: number
  /** A NFS-e deste kit é do contrato inteiro ou cobre itens de mais de um kit. */
  nota_compartilhada?: boolean
}

export interface ClienteKits {
  cliente_id: string | null
  nome: string
  valor_total: number
  kits: number
  casos: KitCaso[]
}

export interface ComposicaoPayload {
  resumo: {
    kits: number
    valor_total: number
    por_status: Partial<Record<StatusKit, { kits: number; valor: number }>>
  }
  opcoes: {
    competencias: string[]
    clientes: Array<{ id: string; nome: string }>
    contratos: Array<{ id: string; numero: number | null; nome: string | null; cliente_id: string | null }>
    casos: Array<{ id: string; numero: number | null; nome: string | null; contrato_id: string }>
    regras: string[]
  }
  clientes: ClienteKits[]
}

export interface FiltrosComposicao {
  competencia: string | null
  clienteId: string | null
  contratoId: string | null
  casoId: string | null
  regra: string | null
  statusKit: StatusKit | null
}

export const FILTROS_VAZIOS: FiltrosComposicao = {
  competencia: null,
  clienteId: null,
  contratoId: null,
  casoId: null,
  regra: null,
  statusKit: null,
}

/** Uma aba da barra de meses da Composição: kits e valor do mês inteiro. */
export interface AbaCompetencia {
  /** 'YYYY-MM-01' */
  competencia: string
  kits: number
  valor: number
}

/**
 * Contagem de kits e valor por competência a partir de uma resposta SEM
 * filtro da RPC (clientes[].casos[] traz todos os kits). É o que alimenta
 * os badges das abas; uma chamada só, em vez de uma por mês.
 */
export function contarKitsPorMes(payload: ComposicaoPayload | null): Map<string, { kits: number; valor: number }> {
  const mapa = new Map<string, { kits: number; valor: number }>()
  for (const cliente of payload?.clientes ?? []) {
    for (const kit of cliente.casos) {
      const atual = mapa.get(kit.competencia) ?? { kits: 0, valor: 0 }
      atual.kits += 1
      atual.valor += Number(kit.valor_total || 0)
      mapa.set(kit.competencia, atual)
    }
  }
  return mapa
}

/**
 * Abas = meses com kit ∪ mês corrente ∪ mês seguinte ∪ a aba escolhida (para
 * ela nunca sumir debaixo da pessoa), em ordem crescente.
 */
export function montarAbasCompetencia(
  contagens: Map<string, { kits: number; valor: number }>,
  mesAtual: string,
  mesSeguinte: string,
  escolhida: string | null,
): AbaCompetencia[] {
  const chaves = new Set<string>([mesAtual, mesSeguinte, ...Array.from(contagens.keys())])
  if (escolhida) chaves.add(escolhida)
  return Array.from(chaves)
    .sort()
    .map((competencia) => ({ competencia, kits: contagens.get(competencia)?.kits ?? 0, valor: contagens.get(competencia)?.valor ?? 0 }))
}

/**
 * Competência padrão da Composição: a salva pela pessoa (se ainda faz
 * sentido, i.e. está entre as abas), senão o mês corrente se tiver kit,
 * senão o mais recente com kit, senão o mês corrente.
 */
export function competenciaPadraoComposicao(mesesComKit: string[], mesAtual: string, salva: string | null): string {
  if (salva && (salva === mesAtual || mesesComKit.includes(salva))) return salva
  if (mesesComKit.includes(mesAtual)) return mesAtual
  const maisRecente = [...mesesComKit].sort().at(-1)
  return maisRecente ?? mesAtual
}

/** Filtros da barra (sem a competência, que é a aba e está sempre preenchida). */
export function temFiltroAlemDaCompetencia(filtros: FiltrosComposicao) {
  return Boolean(filtros.clienteId || filtros.contratoId || filtros.casoId || filtros.regra || filtros.statusKit)
}

export function formatMoney(value: number | null | undefined) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0))
}

/** '2026-09-01' → "setembro de 2026". */
export function labelCompetencia(competencia: string | null | undefined) {
  if (!competencia) return '—'
  const m = /^(\d{4})-(\d{2})/.exec(competencia)
  if (!m) return competencia
  const d = new Date(Number(m[1]), Number(m[2]) - 1, 1)
  return d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
}

/** '2026-09-01' → "setembro/2026" (faixa dos PDFs). */
export function labelCompetenciaCurta(competencia: string | null | undefined) {
  if (!competencia) return ''
  const m = /^(\d{4})-(\d{2})/.exec(competencia)
  if (!m) return competencia
  const d = new Date(Number(m[1]), Number(m[2]) - 1, 1)
  return `${d.toLocaleDateString('pt-BR', { month: 'long' })}/${m[1]}`
}

export function dataBR(value: string | null | undefined) {
  if (!value) return '—'
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10).split('-').reverse().join('/')
  return value
}

export function dataHoraBR(value: string | null | undefined) {
  if (!value) return '—'
  const dt = new Date(value)
  if (Number.isNaN(dt.getTime())) return value
  return dt.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

export function isoHoje() {
  return new Date().toISOString().slice(0, 10)
}

const REGRA_LABEL: Record<string, string> = {
  hora: 'Por hora',
  hora_trabalhada: 'Por hora',
  mensalidade: 'Mensalidade',
  mensalidade_carteira: 'Mensalidade (carteira)',
  pro_labore: 'Pró-labore',
  projeto: 'Projeto',
  parcela: 'Parcelado',
  exito: 'Êxito',
  salario_minimo: 'Salário mínimo',
}

export function labelRegra(regra: string | null | undefined) {
  if (!regra) return 'Sem regra'
  return REGRA_LABEL[regra] || regra.replace(/_/g, ' ')
}

const ORIGEM_LABEL: Record<string, string> = {
  timesheet: 'Timesheet',
  despesa: 'Despesa',
  mensalidade: 'Mensalidade',
  pro_labore: 'Pró-labore',
  projeto: 'Projeto',
  parcela: 'Parcela',
  exito: 'Êxito',
  regra_financeira: 'Regra financeira',
}

export function labelOrigem(origem: string | null | undefined) {
  if (!origem) return '—'
  return ORIGEM_LABEL[origem] || origem.replace(/_/g, ' ')
}

/** Pior status entre os kits do cliente = o mais atrasado na esteira. */
export function piorStatus(casos: KitCaso[]): StatusKit {
  let pior = STATUS_KIT_ORDEM.length - 1
  for (const c of casos) {
    const i = STATUS_KIT_ORDEM.indexOf(c.status_kit)
    if (i >= 0 && i < pior) pior = i
  }
  return STATUS_KIT_ORDEM[pior] ?? 'pendente'
}

export function labelCaso(kit: Pick<KitCaso, 'caso_numero' | 'caso_nome'>) {
  return kit.caso_numero ? `#${kit.caso_numero} · ${kit.caso_nome}` : kit.caso_nome
}

// ── Progresso do kit por documentos (mock do Filipe, 21/09) ─────────────
//
// Só conta no front: quais documentos o kit PRECISA (NFS-e e boleto sempre;
// relatório quando há horas; nota de débito quando há despesa) e quantos já
// saíram. A esteira status_kit (pendente → recebido) continua vindo da RPC e
// é outra régua — esta diz "quanto do kit está montado". Desde 25/09 o
// bloco do caso mostra isso como um "stepper" de 4 etapas rotuladas (NF ·
// Boleto · Timesheet · Despesas), por isso cada segmento carrega o rótulo e
// se é necessário neste kit.

export type SituacaoKit = 'nao_iniciado' | 'em_andamento' | 'completo'

export interface EtapaKit {
  rotulo: 'NF' | 'Boleto' | 'Timesheet' | 'Despesas'
  /** Este kit precisa deste documento? (Timesheet só com horas; Despesas só com despesa.) */
  necessaria: boolean
  emitida: boolean
}

export interface ProgressoKit {
  emitidos: number
  necessarios: number
  /** 0–100, inteiro. */
  pct: number
  situacao: SituacaoKit
  /** Um booleano por documento necessário, na ordem NFS-e, boleto, relatório, nota de débito. */
  segmentos: boolean[]
  /** As 4 etapas do stepper, sempre presentes (as não necessárias ficam apagadas). */
  etapas: EtapaKit[]
}

export const SITUACAO_INFO: Record<SituacaoKit, {
  label: string
  /** Badge do cabeçalho do card. */
  badge: string
  /** Card de KPI em repouso / selecionado. */
  kpi: string
  kpiAtivo: string
  /** Cor do número no KPI. */
  numero: string
  descricao: string
}> = {
  completo: {
    label: 'Kit completo',
    badge: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    kpi: 'border-hairline bg-white hover:border-emerald-300',
    kpiAtivo: 'border-emerald-500 bg-emerald-50 ring-2 ring-emerald-200',
    numero: 'text-emerald-600',
    descricao: 'finalizado',
  },
  em_andamento: {
    label: 'Em andamento',
    badge: 'border-orange-200 bg-orange-50 text-orange-800',
    kpi: 'border-hairline bg-white hover:border-orange-300',
    kpiAtivo: 'border-orange-500 bg-orange-50 ring-2 ring-orange-200',
    numero: 'text-orange-600',
    descricao: 'documentos em emissão',
  },
  nao_iniciado: {
    label: 'Não iniciado',
    badge: 'border-hairline bg-canvas-soft text-ink-secondary',
    kpi: 'border-hairline bg-white hover:border-gray-400',
    kpiAtivo: 'border-gray-500 bg-canvas-soft ring-2 ring-gray-300',
    numero: 'text-ink-secondary',
    descricao: 'nenhum documento emitido',
  },
}

/** NFS-e que conta como emitida: gerada e autorizada (ou a caminho). */
export function nfseEmitida(nfse: DocNfse | null) {
  return !!nfse && nfse.status === 'gerado' && ['autorizado', 'processando'].includes(nfse.focus_status ?? '')
}

/** Boleto vivo: existe e não foi cancelado, baixado nem deu erro. */
export function boletoEmitido(boleto: DocBoleto | null) {
  return !!boleto && !['cancelado', 'erro', 'baixado'].includes(boleto.status)
}

/** Kit sem serviço a faturar: só despesas reembolsáveis (não há NFS-e a emitir). */
export function kitSoDespesas(kit: Pick<KitCaso, 'valor_servico' | 'valor_despesa'>) {
  return Number(kit.valor_servico || 0) <= 0 && Number(kit.valor_despesa || 0) > 0
}

/**
 * Base do boleto quando a RPC não manda `boleto_base`: NFS-e autorizada →
 * 'nfse'; senão nada (a conta da nota de débito só existe com a RPC nova, que
 * manda o campo). Com o campo presente, vale o que a RPC decidiu.
 */
export function baseDoBoleto(kit: KitCaso): BoletoBase | null {
  if (kit.boleto_base !== undefined) return kit.boleto_base
  const nfse = kit.documentos.nfse
  return !!nfse && nfse.status === 'gerado' && nfse.focus_status === 'autorizado' ? 'nfse' : null
}

/** Id do documento sobre o qual o boleto é emitido (bol_lancamento_da_nota acha o lançamento por ele). */
export function documentoBaseDoBoleto(kit: KitCaso): { base: BoletoBase; notaId: string } | null {
  const base = baseDoBoleto(kit)
  if (base === 'nfse' && kit.documentos.nfse) return { base, notaId: kit.documentos.nfse.id }
  if (base === 'nota_debito' && kit.documentos.nota_debito) return { base, notaId: kit.documentos.nota_debito.id }
  return null
}

/** NFS-e conjunta (de contrato) viva neste kit: não se emite outra nem se devolve o kit sozinho. */
export function nfseConjuntaViva(kit: KitCaso) {
  return kit.nota_compartilhada === true && !!kit.documentos.nfse && kit.documentos.nfse.status === 'gerado'
}

/**
 * Grupos (contrato + competência) com ≥ 2 kits candidatos à nota única: têm
 * serviço, não têm NFS-e viva e a RPC diz que têm irmãos. Só conta kits
 * presentes na lista — se o filtro escondeu um irmão, o botão não aparece
 * para não emitir uma nota que cobre o que não está na tela.
 */
export function gruposParaNotaUnica(kits: KitCaso[]): KitCaso[][] {
  const grupos = new Map<string, KitCaso[]>()
  for (const k of kits) {
    if ((k.irmaos_no_contrato ?? 0) < 2) continue
    if (Number(k.valor_servico || 0) <= 0) continue
    if (k.documentos.nfse && k.documentos.nfse.status === 'gerado') continue
    const chave = `${k.contrato_id}|${k.competencia}`
    const lista = grupos.get(chave) ?? []
    lista.push(k)
    grupos.set(chave, lista)
  }
  return Array.from(grupos.values()).filter((g) => g.length >= 2)
}

export function etapasDoKit(kit: KitCaso): EtapaKit[] {
  const docs = kit.documentos
  return [
    // Kit só de despesas não tem NFS-e a emitir (07/10): a etapa fica
    // "não se aplica" em vez de pendente para sempre.
    { rotulo: 'NF', necessaria: Number(kit.valor_servico || 0) > 0 || nfseEmitida(docs.nfse), emitida: nfseEmitida(docs.nfse) },
    { rotulo: 'Boleto', necessaria: true, emitida: boletoEmitido(docs.boleto) },
    { rotulo: 'Timesheet', necessaria: kit.horas > 0, emitida: !!docs.relatorio_timesheet },
    { rotulo: 'Despesas', necessaria: kit.valor_despesa > 0, emitida: !!docs.nota_debito },
  ]
}

export function progressoDoKit(kit: KitCaso): ProgressoKit {
  const etapas = etapasDoKit(kit)
  return montarProgresso(etapas.filter((e) => e.necessaria).map((e) => e.emitida), etapas)
}

function montarProgresso(segmentos: boolean[], etapas: EtapaKit[]): ProgressoKit {
  const necessarios = segmentos.length
  const emitidos = segmentos.filter(Boolean).length
  const pct = necessarios > 0 ? Math.round((emitidos / necessarios) * 100) : 0
  const situacao: SituacaoKit = emitidos === 0 ? 'nao_iniciado' : emitidos >= necessarios ? 'completo' : 'em_andamento'
  return { emitidos, necessarios, pct, situacao, segmentos, etapas }
}

/** Soma dos kits de um cliente (ou de todos): os segmentos são concatenados. */
export function somarProgresso(kits: KitCaso[]): ProgressoKit {
  return montarProgresso(kits.flatMap((k) => progressoDoKit(k).segmentos), [])
}

/** Kit finalizado (baixa manual) ou já recebido: conta como "Kit completo" no KPI. */
export function kitFinalizado(kit: Pick<KitCaso, 'status_kit'>) {
  return kit.status_kit === 'finalizado' || kit.status_kit === 'recebido'
}

/**
 * Situação do kit para os KPIs e o filtro de tela (Filipe, 24/09): "Kit
 * completo" é o kit FINALIZADO (ou recebido), não o que só tem todos os
 * documentos — ter tudo emitido e ainda não ter dado a baixa é "em andamento".
 */
export function situacaoDoKit(kit: KitCaso): SituacaoKit {
  if (kitFinalizado(kit)) return 'completo'
  const p = progressoDoKit(kit)
  return p.emitidos === 0 ? 'nao_iniciado' : 'em_andamento'
}

/** Situação do cartão do cliente: o pior entre os kits dele. */
export function situacaoDosKits(kits: KitCaso[]): SituacaoKit {
  const ordem: SituacaoKit[] = ['nao_iniciado', 'em_andamento', 'completo']
  let pior = ordem.length - 1
  for (const k of kits) {
    const i = ordem.indexOf(situacaoDoKit(k))
    if (i < pior) pior = i
  }
  return ordem[pior] ?? 'nao_iniciado'
}

/** Duas letras para o avatar: iniciais das duas primeiras palavras, ou as duas primeiras letras. */
export function iniciaisCliente(nome: string) {
  const palavras = nome.trim().split(/\s+/).filter((p) => /^[\p{L}\p{N}]/u.test(p))
  const letras = palavras.length >= 2 ? palavras[0][0] + palavras[1][0] : nome.trim().slice(0, 2)
  return letras.toLocaleUpperCase('pt-BR') || '?'
}
