// Tipos e utilidades da Composição da fatura (lote C).
//
// Espelham o JSON de public.get_composicao_fatura (migração
// 20260923100000_composicao_kit_por_caso.sql). O kit é (caso, competência);
// item sem caso agrupa num bloco "Sem caso" por contrato. Quem muda o
// contrato da RPC muda aqui — não há geração automática de tipos.

export type StatusKit = 'pendente' | 'nf_emitida' | 'enviado' | 'recebido'

export const STATUS_KIT_ORDEM: StatusKit[] = ['pendente', 'nf_emitida', 'enviado', 'recebido']

// Cores pedidas pelo Filipe (21/09): pendente âmbar, NF emitida azul, enviado
// verde, recebido esmeralda escuro; falha de envio em vermelho.
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
  horas: number
  valor_total: number
  itens: ItemKit[]
  documentos: {
    nfse: DocNfse | null
    boleto: DocBoleto | null
    relatorio_timesheet: DocGerado | null
    nota_debito: DocGerado | null
  }
  envio: EnvioKit | null
  conta_receber: ContaReceberKit | null
  status_kit: StatusKit
  pode_excluir: boolean
  motivo_bloqueio: string | null
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
