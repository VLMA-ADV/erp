'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Clock, Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { CommandSelect, type CommandSelectOption } from '@/components/ui/command-select'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Table } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/toast'
import { usePermissionsContext } from '@/lib/contexts/permissions-context'

interface RevisaoItem {
  id: string
  contratoId: string
  casoId: string
  timesheetId: string | null
  status: string
  origemTipo: string
  casoRegraCobranca: string
  dataReferencia: string
  clienteNome: string
  contratoNome: string
  contratoNumero: number | null
  casoNome: string
  casoNumero: number | null
  regraNome: string
  horasInformadas: number | null
  horasRevisadas: number | null
  horasAprovadas: number | null
  valorInformado: number | null
  valorRevisado: number | null
  valorAprovado: number | null
  responsavelFluxoNome: string | null
  responsavelRevisaoId: string | null
  responsavelRevisaoNome: string | null
  responsavelAprovacaoId: string | null
  responsavelAprovacaoNome: string | null
  enviadoPorId: string | null
  enviadoPorNome: string | null
  dataRevisao: string | null
  dataAprovacao: string | null
  timesheetDataLancamento: string
  timesheetHoras: number
  timesheetDescricao: string
  timesheetProfissional: string
  timesheetValorHora: number
  snapshot: Record<string, unknown>
  historico: RevisaoHistoricoEntry[]
}

interface CasoGroup {
  key: string
  nome: string
  numero: number | null
  itens: RevisaoItem[]
}

interface ClienteGroup {
  key: string
  nome: string
  casos: CasoGroup[]
}

interface ContratoOption {
  id: string
  numero?: number | null
  numero_sequencial?: number | null
  cliente_id?: string | null
  cliente_nome?: string | null
  nome_contrato?: string | null
  status?: string | null
  casos?: Array<{ id: string; numero?: number | null; nome: string }>
}

interface ColaboradorOption {
  id: string
  nome: string
}

interface TimesheetRowDraft {
  id: string
  dataLancamento: string
  profissional: string
  atividade: string
  horasIniciais: string
  horasRevisadas: string
  valorHoraInicial: string
  valorHora: string
}

interface ValueRowDraft {
  id: string
  referencia: string
  descricao: string
  valorOriginal: string
  valorRevisado: string
}

interface DraftFields {
  casoId: string
  profissional: string
  horas: string
  valor: string
  observacao: string
  timesheetRows: TimesheetRowDraft[]
  valueRows: ValueRowDraft[]
}

interface CaseMetrics {
  totalHoras: number
  totalValor: number
  itemCount: number
  timesheetItems: RevisaoItem[]
  nonTimesheetItems: RevisaoItem[]
}

type ReviewMode = 'default' | 'timesheet'
type RuleFilterKey =
  | 'all'
  | 'hora'
  | 'mensalidade_processo'
  | 'mensalidade'
  | 'projeto'
  | 'projeto_parcelado'
  | 'exito'
  | 'despesa'
type HistoricoRole = 'USUARIO' | 'REVISOR' | 'APROVADOR'


interface RevisaoHistoricoEntry {
  id: string
  billingItemId: string
  role: HistoricoRole
  authorId: string
  authorName: string
  horas: number
  valor: number
  texto: string | null
  tenantId: string
  createdAt: string
}


function asString(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

function asNumber(value: unknown, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function asOptionalNumber(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function pickFirstDefined(...values: unknown[]) {
  for (const value of values) {
    if (value !== null && value !== undefined && value !== '') return value
  }
  return undefined
}

function toObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function parseDecimalInput(value: string) {
  const normalized = value.replace(',', '.').trim()
  if (!normalized) return 0
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : 0
}

function sanitizeMinutesInput(value: string) {
  return value.replace(/\D/g, '')
}

function minutesToHoursString(minutesInput: string) {
  const sanitized = sanitizeMinutesInput(minutesInput)
  if (!sanitized) return '0'
  const minutes = Number(sanitized)
  if (!Number.isFinite(minutes) || minutes < 0) return '0'
  const hours = minutes / 60
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')
}

function hoursToMinutes(value: number | null | undefined) {
  return Math.max(0, Math.round(Number(value || 0) * 60))
}

function splitMinutosTotal(total: number | string | null | undefined) {
  const parsed = Number(total || 0)
  if (Number.isNaN(parsed) || parsed < 0) return { horas: '0', minutos: '0' }
  const inteiro = Math.floor(parsed)
  return { horas: String(Math.floor(inteiro / 60)), minutos: String(inteiro % 60) }
}

function computeMinutosFromHHMM(horas: string, minutos: string) {
  const h = Math.max(0, Math.floor(Number(horas || 0)))
  const mRaw = Math.max(0, Math.floor(Number(minutos || 0)))
  const m = Math.min(mRaw, 60)
  return h * 60 + m
}

function normalizeDateInput(value: string) {
  if (!value) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString().slice(0, 10)
}

function normalizeDateFromDisplay(value: string) {
  if (!value) return ''
  const trimmed = value.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed
  const parts = trimmed.split('/')
  if (parts.length === 3) {
    const [day, month, year] = parts
    if (day?.length === 2 && month?.length === 2 && year?.length === 4) {
      return `${year}-${month}-${day}`
    }
  }
  return normalizeDateInput(trimmed) || trimmed
}

function getNextBillingPeriodDate(item: RevisaoItem) {
  const reference = normalizeDateFromDisplay(item.dataReferencia || item.timesheetDataLancamento)
  const fallbackDate = new Date()
  const parsedReference = reference ? new Date(`${reference}T00:00:00`) : fallbackDate
  const baseDate = Number.isNaN(parsedReference.getTime()) ? fallbackDate : parsedReference
  return new Date(baseDate.getFullYear(), baseDate.getMonth() + 1, 1)
}

function formatDate(value: string) {
  if (!value) return '-'
  const normalized = normalizeDateFromDisplay(value)
  const [year, month, day] = normalized.split('-')
  if (!year || !month || !day) return value
  return `${day}/${month}/${year}`
}

function formatDateTime(value: string) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return formatDate(value)
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatMoney(value: number | null | undefined) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0))
}

function formatHours(value: number | null | undefined) {
  return Number(value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// Horas como no timesheet: "1h 20min" (1,33 confunde o revisor).
function formatHistoryHours(value: number | null | undefined) {
  const total = Number(value || 0)
  if (!total) return '0h'
  const totalMin = Math.round(total * 60)
  const h = Math.floor(totalMin / 60)
  const min = totalMin % 60
  if (h === 0) return `${min}min`
  return min > 0 ? `${h}h ${min}min` : `${h}h`
}

function getOriginalItemHours(item: RevisaoItem) {
  if (item.horasInformadas !== null && item.horasInformadas !== undefined) return item.horasInformadas
  if (item.timesheetHoras) return item.timesheetHoras
  return 0
}

function getOriginalItemValue(item: RevisaoItem) {
  if (item.valorInformado !== null && item.valorInformado !== undefined) return item.valorInformado
  if (item.origemTipo === 'timesheet') {
    return getOriginalItemHours(item) * item.timesheetValorHora
  }
  return 0
}

function areStageNumbersEqual(left: number | null | undefined, right: number | null | undefined) {
  if (left === null || left === undefined) return right === null || right === undefined
  if (right === null || right === undefined) return false
  return Number(left) === Number(right)
}




function isReviewQueueStatus(status: string) {
  return status === 'em_revisao' || status === 'em_aprovacao'
}

function canAdvance(status: string) {
  return status === 'em_revisao' || status === 'em_aprovacao'
}

function getEffectiveItemHours(item: RevisaoItem) {
  if (item.status === 'em_aprovacao' && item.horasAprovadas !== null && item.horasAprovadas !== undefined) {
    return item.horasAprovadas
  }
  if (item.horasRevisadas !== null && item.horasRevisadas !== undefined) return item.horasRevisadas
  if (item.horasInformadas !== null && item.horasInformadas !== undefined) return item.horasInformadas
  return 0
}

function getEffectiveItemValue(item: RevisaoItem) {
  if (item.status === 'em_aprovacao' && item.valorAprovado !== null && item.valorAprovado !== undefined) {
    return item.valorAprovado
  }
  if (item.valorRevisado !== null && item.valorRevisado !== undefined) return item.valorRevisado
  if (item.valorInformado !== null && item.valorInformado !== undefined) return item.valorInformado
  return 0
}

// Compara a etapa com a anterior para exibir a tag (Sem alterações / Alterado)
// e o resumo do que mudou — substitui o antigo texto tachado.
function getStageChanges(item: RevisaoItem, role: 'REVISOR' | 'APROVADOR') {
  const hist = item.historico || []
  const stage = [...hist].reverse().find((h) => h.role === role)
  if (!stage) return null
  const baseRole = role === 'REVISOR' ? 'USUARIO' : 'REVISOR'
  const base = [...hist].reverse().find((h) => h.role === baseRole) || hist.find((h) => h.role === 'USUARIO')
  const changes: string[] = []
  if (base) {
    if (Number(stage.horas || 0) !== Number(base.horas || 0)) {
      changes.push(`${formatHistoryHours(base.horas)} \u2192 ${formatHistoryHours(stage.horas)}`)
    }
    if (Number(stage.valor || 0) !== Number(base.valor || 0)) {
      changes.push(`${formatMoney(base.valor)} \u2192 ${formatMoney(stage.valor)}`)
    }
    if ((stage.texto || '').trim() && (stage.texto || '').trim() !== (base.texto || '').trim()) {
      changes.push('texto editado')
    }
  }
  return { alterado: changes.length > 0, changes, quando: stage.createdAt, texto: (stage.texto || '').trim() }
}

function StageTag({ alterado, changes }: { alterado: boolean; changes: string[] }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span
        className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
          alterado ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-700'
        }`}
      >
        {alterado ? 'Alterado' : 'Sem alterações'}
      </span>
      {alterado && changes.length > 0 ? <span className="text-xs text-ink-mute">{changes.join(' · ')}</span> : null}
    </span>
  )
}

function getRuleKind(item: RevisaoItem) {
  return asString(item.snapshot?.regra_cobranca || '').trim().toLowerCase()
}

function getRuleTitle(item: RevisaoItem) {
  if (item.origemTipo === 'despesa') return 'Despesa'
  const kind = getRuleKind(item)
  if (kind === 'mensalidade_processo') return 'Mensalidade de processo'
  if (kind === 'mensal') return 'Mensalidade'
  if (kind === 'exito') return 'Exito'
  if (kind === 'projeto' || kind === 'projeto_parcelado') return 'Unico'
  if (kind === 'hora' || kind === 'hora_com_cap') return 'Horas'
  return item.regraNome || 'Regra financeira'
}

// Aba pela regra do caso: hora lançada em caso que não é hora pura
// cai na aba da regra (mensalidade de processo, projeto, êxito...).
function ruleKeyFromKind(kind: string): RuleFilterKey | null {
  if (kind === 'mensalidade_processo' || kind === 'salario_minimo') return 'mensalidade_processo'
  if (kind === 'mensal') return 'mensalidade'
  if (kind === 'projeto') return 'projeto'
  if (kind === 'projeto_parcela' || kind === 'projeto_parcelado') return 'projeto_parcelado'
  if (kind === 'exito') return 'exito'
  return null
}

function getRuleFilterKey(item: RevisaoItem): RuleFilterKey | null {
  if (item.origemTipo === 'despesa') return 'despesa'
  const kind = getRuleKind(item)
  const casoKind = (item.casoRegraCobranca || '').trim().toLowerCase()
  if (item.origemTipo === 'timesheet') {
    return ruleKeyFromKind(casoKind) ?? 'hora'
  }
  if (kind === 'hora' || kind === 'hora_com_cap') return 'hora'
  if (kind === 'mensalidade_processo') return 'mensalidade_processo'
  if (kind === 'mensal') return 'mensalidade'
  if (kind === 'projeto') return 'projeto'
  if (kind === 'projeto_parcela' || kind === 'projeto_parcelado') return 'projeto_parcelado'
  if (kind === 'exito') return 'exito'
  return null
}

function getRuleFilterLabel(key: RuleFilterKey) {
  switch (key) {
    case 'all':
      return 'Todas'
    case 'hora':
      return 'Horas'
    case 'mensalidade_processo':
      return 'Mensalidade de processo'
    case 'mensalidade':
      return 'Mensalidade'
    case 'projeto':
      return 'Projeto'
    case 'projeto_parcelado':
      return 'Projeto parcelado'
    case 'exito':
      return 'Êxito'
    case 'despesa':
      return 'Despesas'
  }
}

function createDraftRowId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function parseSnapshotTimesheetRows(item: RevisaoItem): TimesheetRowDraft[] {
  const rawRows = Array.isArray(item.snapshot?.timesheet_itens_revisao) ? (item.snapshot.timesheet_itens_revisao as unknown[]) : []
  if (rawRows.length > 0) {
    return rawRows
      .map((entry) => {
        const row = toObject(entry)
        if (!row) return null
        return {
          id: asString(row.id) || createDraftRowId(),
          dataLancamento: normalizeDateInput(asString(row.data_lancamento)),
          profissional: asString(row.profissional),
          atividade: asString(row.atividade ?? row.descricao),
          horasIniciais: String(asNumber(row.horas_iniciais ?? row.horas_informadas ?? row.horas)),
          horasRevisadas: String(asNumber(row.horas_revisadas ?? row.horas ?? row.horas_iniciais)),
          valorHoraInicial: String(asNumber(row.valor_hora_inicial ?? row.valor_hora)),
          valorHora: String(asNumber(row.valor_hora)),
        }
      })
      .filter((row): row is TimesheetRowDraft => row !== null)
  }

  return [
    {
      id: item.timesheetId || createDraftRowId(),
      dataLancamento: item.timesheetDataLancamento,
      profissional: item.timesheetProfissional,
      atividade: item.timesheetDescricao,
      horasIniciais: String(item.timesheetHoras || item.horasInformadas || 0),
      horasRevisadas: String(item.horasRevisadas ?? item.timesheetHoras ?? item.horasInformadas ?? 0),
      valorHoraInicial: String(item.timesheetValorHora || 0),
      valorHora: String(item.timesheetValorHora || 0),
    },
  ]
}

function parseSnapshotValueRows(item: RevisaoItem): ValueRowDraft[] {
  const rawRows = Array.isArray(item.snapshot?.valor_itens_revisao) ? (item.snapshot.valor_itens_revisao as unknown[]) : []
  if (rawRows.length > 0) {
    return rawRows
      .map((entry) => {
        const row = toObject(entry)
        if (!row) return null
        return {
          id: asString(row.id) || createDraftRowId(),
          referencia: asString(row.referencia || row.data_referencia),
          descricao: asString(row.descricao),
          valorOriginal: String(asNumber(row.valor_original ?? row.valor_informado ?? row.valor)),
          valorRevisado: String(asNumber(row.valor_revisado ?? row.valor)),
        }
      })
      .filter((row): row is ValueRowDraft => row !== null)
  }

  return [
    {
      id: createDraftRowId(),
      referencia: item.dataReferencia || '',
      descricao: getRuleTitle(item),
      valorOriginal: String(item.valorInformado ?? 0),
      valorRevisado: String(getEffectiveItemValue(item)),
    },
  ]
}

function normalizeHistoricoRole(value: unknown): HistoricoRole | null {
  if (value === 'USUARIO' || value === 'REVISOR' || value === 'APROVADOR') return value
  return null
}

function normalizeHistorico(raw: unknown): RevisaoHistoricoEntry[] {
  if (!Array.isArray(raw)) return []

  return raw
    .map((entry, index) => {
      const row = toObject(entry)
      if (!row) return null

      const role = normalizeHistoricoRole(row.role)
      const billingItemId = asString(row.billing_item_id)
      const authorId = asString(row.author_id)
      const createdAt = asString(row.created_at)

      if (!role || !billingItemId || !authorId || !createdAt) return null

      return {
        id: asString(row.id) || `${billingItemId}:${role}:${createdAt}:${index}`,
        billingItemId,
        role,
        authorId,
        authorName: asString(row.author_name, 'Usuário'),
        horas: asNumber(row.horas),
        valor: asNumber(row.valor),
        texto: asString(row.texto) || null,
        tenantId: asString(row.tenant_id),
        createdAt,
      }
    })
    .filter((entry): entry is RevisaoHistoricoEntry => entry !== null)
    .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime())
}

function normalizeItem(raw: unknown): RevisaoItem | null {
  if (!raw || typeof raw !== 'object') return null
  const data = raw as Record<string, unknown>
  const id = asString(pickFirstDefined(data.billing_item_id, data.item_id, data.id))
  if (!id) return null
  const snapshot = toObject(data.snapshot) || {}

  return {
    id,
    contratoId: asString(data.contrato_id),
    casoId: asString(data.caso_id),
    timesheetId: asString(data.timesheet_id) || null,
    status: asString(data.status, 'em_revisao'),
    origemTipo: asString(data.origem_tipo, ''),
    casoRegraCobranca: asString(pickFirstDefined(data.caso_regra_cobranca, snapshot.regra_cobranca), ''),
    dataReferencia: asString(data.data_referencia, ''),
    clienteNome: asString(data.cliente_nome, 'Cliente sem nome'),
    contratoNome: asString(data.contrato_nome, 'Contrato sem nome'),
    contratoNumero: asOptionalNumber(data.contrato_numero),
    casoNome: asString(data.caso_nome, 'Caso sem nome'),
    casoNumero: asOptionalNumber(data.caso_numero),
    regraNome: asString(pickFirstDefined(data.regra_nome, data.descricao, data.origem_tipo), 'Regra financeira'),
    horasInformadas: asOptionalNumber(pickFirstDefined(data.horas_informadas, data.snapshot_horas_informadas, data.horas)),
    horasRevisadas: asOptionalNumber(pickFirstDefined(data.horas_revisadas, data.snapshot_horas_revisadas, data.horas)),
    horasAprovadas: asOptionalNumber(pickFirstDefined(data.horas_aprovadas, data.snapshot_horas_aprovadas, data.horas)),
    valorInformado: asOptionalNumber(pickFirstDefined(data.valor_informado, data.snapshot_valor_informado, data.valor)),
    valorRevisado: asOptionalNumber(pickFirstDefined(data.valor_revisado, data.snapshot_valor_revisado, data.valor)),
    valorAprovado: asOptionalNumber(pickFirstDefined(data.valor_aprovado, data.snapshot_valor_aprovado, data.valor)),
    responsavelFluxoNome: asString(pickFirstDefined(data.responsavel_fluxo_nome, snapshot.responsavel_fluxo_nome)) || null,
    responsavelRevisaoId: asString(pickFirstDefined(data.responsavel_revisao_id, snapshot.responsavel_revisao_id)) || null,
    responsavelRevisaoNome: asString(pickFirstDefined(data.responsavel_revisao_nome, snapshot.responsavel_revisao_nome)) || null,
    responsavelAprovacaoId: asString(pickFirstDefined(data.responsavel_aprovacao_id, snapshot.responsavel_aprovacao_id)) || null,
    responsavelAprovacaoNome: asString(pickFirstDefined(data.responsavel_aprovacao_nome, snapshot.responsavel_aprovacao_nome)) || null,
    enviadoPorId: asString(pickFirstDefined(data.enviado_por_id, snapshot.enviado_por_id)) || null,
    enviadoPorNome: asString(pickFirstDefined(data.enviado_por_nome, snapshot.enviado_por_nome)) || null,
    dataRevisao: normalizeDateInput(asString(pickFirstDefined(data.data_revisao, snapshot.data_revisao))),
    dataAprovacao: normalizeDateInput(asString(pickFirstDefined(data.data_aprovacao, snapshot.data_aprovacao))),
    timesheetDataLancamento: normalizeDateInput(asString(data.timesheet_data_lancamento)),
    timesheetHoras: asNumber(pickFirstDefined(data.timesheet_horas, data.horas_informadas)),
    timesheetDescricao: asString(data.timesheet_descricao),
    timesheetProfissional: asString(data.timesheet_profissional),
    timesheetValorHora: asNumber(data.timesheet_valor_hora),
    snapshot,
    historico: normalizeHistorico(data.historico),
  }
}

function buildTree(items: RevisaoItem[]): ClienteGroup[] {
  const clientes = new Map<string, ClienteGroup>()

  // agrupamento direto cliente -> caso (sem a camada de contrato, mock A-Tabela)
  for (const item of items) {
    const clienteKey = item.clienteNome || 'cliente'
    if (!clientes.has(clienteKey)) {
      clientes.set(clienteKey, {
        key: clienteKey,
        nome: item.clienteNome,
        casos: [],
      })
    }

    const cliente = clientes.get(clienteKey)
    if (!cliente) continue

    const casoKey = `${item.casoNumero || 'sem-numero'}-${item.casoNome}`
    let caso = cliente.casos.find((entry) => entry.key === casoKey)
    if (!caso) {
      caso = {
        key: casoKey,
        nome: item.casoNome,
        numero: item.casoNumero,
        itens: [],
      }
      cliente.casos.push(caso)
    }

    caso.itens.push(item)
  }

  return Array.from(clientes.values())
}

// TODOS os lançamentos de timesheet do caso contam e aparecem — antes só o
// primeiro ([0]) era exibido/revisável e os demais ficavam invisíveis na grid.
function getCaseBaseMetrics(casoGroup: CasoGroup): CaseMetrics {
  const timesheetItems = casoGroup.itens.filter((item) => item.origemTipo === 'timesheet')
  const nonTimesheetItems = casoGroup.itens.filter((item) => item.origemTipo !== 'timesheet')

  return {
    totalHoras: nonTimesheetItems.reduce((acc, item) => acc + getEffectiveItemHours(item), 0) +
      timesheetItems.reduce((acc, item) => acc + getEffectiveItemHours(item), 0),
    totalValor: nonTimesheetItems.reduce((acc, item) => acc + getEffectiveItemValue(item), 0) +
      timesheetItems.reduce((acc, item) => acc + getEffectiveItemValue(item), 0),
    itemCount: nonTimesheetItems.length + timesheetItems.length,
    timesheetItems,
    nonTimesheetItems,
  }
}

export default function RevisaoDeFaturaList() {
  const { success, error: toastError } = useToast()
  const { hasPermission } = usePermissionsContext()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [cliente, setCliente] = useState('')
  const [contrato, setContrato] = useState('')
  const [caso, setCaso] = useState('')
  const [items, setItems] = useState<RevisaoItem[]>([])
  const [drafts, setDrafts] = useState<Record<string, DraftFields>>({})
  const [ruleFilter, setRuleFilter] = useState<RuleFilterKey>('all')
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([])
  const [expandedClientes, setExpandedClientes] = useState<Record<string, boolean>>({})
  const [expandedCasos, setExpandedCasos] = useState<Record<string, boolean>>({})
  // Default: tudo recolhido (revisor abre o que interessa); botão alterna geral.
  const [allExpanded, setAllExpanded] = useState(false)
  const toggleAllExpanded = () => {
    setAllExpanded((prev) => !prev)
    setExpandedClientes({})
    setExpandedCasos({})
  }
  const [editorKey, setEditorKey] = useState<string | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [postergarConfirmId, setPostergarConfirmId] = useState<string | null>(null)
  const [allContratos, setAllContratos] = useState<ContratoOption[]>([])
  const [colaboradores, setColaboradores] = useState<ColaboradorOption[]>([])

  const canRead =
    hasPermission('finance.faturamento.read') ||
    hasPermission('finance.faturamento.review') ||
    hasPermission('finance.faturamento.approve') ||
    hasPermission('finance.faturamento.manage')

  const getSessionToken = async () => {
    const supabase = createClient()
    const {
      data: { session },
    } = await supabase.auth.getSession()
    return session?.access_token || null
  }

  const updateDraft = (itemId: string, patch: Partial<DraftFields>) => {
    setDrafts((prev) => ({
      ...prev,
      [itemId]: {
        casoId: prev[itemId]?.casoId || '',
        profissional: prev[itemId]?.profissional || '',
        horas: prev[itemId]?.horas || '0',
        valor: prev[itemId]?.valor || '0',
        observacao: prev[itemId]?.observacao || '',
        timesheetRows: prev[itemId]?.timesheetRows || [],
        valueRows: prev[itemId]?.valueRows || [],
        ...patch,
      },
    }))
  }

  const loadItems = async (options?: { silent?: boolean }) => {
    try {
      if (!options?.silent) setLoading(true)
      setError(null)
      const accessToken = await getSessionToken()
      if (!accessToken) return

      const params = new URLSearchParams()
      if (cliente.trim()) params.set('cliente', cliente.trim())
      if (contrato.trim()) params.set('contrato', contrato.trim())
      if (caso.trim()) params.set('caso', caso.trim())

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-revisao-fatura${params.toString() ? `?${params}` : ''}`,
        {
          method: 'GET',
          cache: 'no-store',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        },
      )

      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(payload.error || 'Erro ao carregar revisão de fatura')
        setItems([])
        return
      }

      const parsed: RevisaoItem[] = Array.isArray(payload.data)
        ? payload.data
            .map((entry: unknown) => normalizeItem(entry))
            .filter((entry: RevisaoItem | null): entry is RevisaoItem => entry !== null && isReviewQueueStatus(entry.status))
        : []

      setItems(parsed)
      setSelectedItemIds((prev) => prev.filter((id) => parsed.some((item) => item.id === id)))

      const nextDrafts: Record<string, DraftFields> = {}
      for (const item of parsed) {
        const timesheetRows = parseSnapshotTimesheetRows(item)
        const valueRows = parseSnapshotValueRows(item)
        const totalHoras = timesheetRows.reduce((acc, row) => acc + parseDecimalInput(row.horasRevisadas || row.horasIniciais), 0)
        const totalValorTimesheet = timesheetRows.reduce(
          (acc, row) => acc + parseDecimalInput(row.horasRevisadas || row.horasIniciais) * parseDecimalInput(row.valorHora),
          0,
        )
        const totalValorRegras = valueRows.reduce((acc, row) => acc + parseDecimalInput(row.valorRevisado), 0)

        nextDrafts[item.id] = {
          casoId: item.casoId,
          profissional: item.timesheetProfissional || '',
          horas: String(item.origemTipo === 'timesheet' ? totalHoras : getEffectiveItemHours(item)),
          valor: String(item.origemTipo === 'timesheet' ? totalValorTimesheet : totalValorRegras || getEffectiveItemValue(item)),
          observacao: '',
          timesheetRows,
          valueRows,
        }
      }
      setDrafts(nextDrafts)
    } catch (loadError) {
      console.error(loadError)
      setError('Erro ao carregar revisão de fatura')
      setItems([])
    } finally {
      setLoading(false)
    }
  }

  const loadAllContratos = async () => {
    try {
      const accessToken = await getSessionToken()
      if (!accessToken) return
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-contratos?_ts=${Date.now()}`,
        {
          method: 'GET',
          cache: 'no-store',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        },
      )
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) return
      const list = Array.isArray(payload.data) ? (payload.data as ContratoOption[]) : []
      setAllContratos(list)
    } catch (loadError) {
      console.error('loadAllContratos', loadError)
    }
  }

  const loadColaboradores = async () => {
    try {
      const accessToken = await getSessionToken()
      if (!accessToken) return
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/list-colaboradores?page=1&limit=500&_ts=${Date.now()}`,
        {
          method: 'GET',
          cache: 'no-store',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        },
      )
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) return
      const raw = Array.isArray(payload.data) ? payload.data : Array.isArray(payload.colaboradores) ? payload.colaboradores : []
      const normalized: ColaboradorOption[] = raw
        .map((entry: any) => ({ id: asString(entry?.id), nome: asString(entry?.nome) }))
        .filter((entry: ColaboradorOption) => entry.id && entry.nome)
      setColaboradores(normalized)
    } catch (loadError) {
      console.error('loadColaboradores', loadError)
    }
  }

  useEffect(() => {
    if (!canRead) return
    void loadItems()
    void loadAllContratos()
    void loadColaboradores()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canRead])

  // A grid reflete envios/revisões de outros usuários sem depender de F5:
  // refetch silencioso ao focar a janela + polling a cada 60s.
  const loadItemsRef = useRef<(options?: { silent?: boolean }) => Promise<void>>()
  loadItemsRef.current = loadItems
  useEffect(() => {
    if (!canRead) return
    const refresh = () => {
      if (document.visibilityState === 'visible') void loadItemsRef.current?.({ silent: true })
    }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    const interval = window.setInterval(refresh, 60_000)
    return () => {
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
      window.clearInterval(interval)
    }
  }, [canRead])

  const visibleItems = useMemo(
    () => (ruleFilter === 'all' ? items : items.filter((item) => getRuleFilterKey(item) === ruleFilter)),
    [items, ruleFilter],
  )

  const statusSummary = useMemo(() => {
    const counts = { revisao: 0, aprovacao: 0, aprovado: 0 }
    for (const item of visibleItems) {
      if (item.status === 'em_revisao') counts.revisao += 1
      else if (item.status === 'em_aprovacao') counts.aprovacao += 1
      else if (item.status === 'aprovado') counts.aprovado += 1
    }
    return counts
  }, [visibleItems])

  const tree = useMemo(() => buildTree(visibleItems), [visibleItems])
  const fullTree = useMemo(() => buildTree(items), [items])

  const clienteFilterOptions = useMemo<CommandSelectOption[]>(() => {
    const names = Array.from(new Set(items.map((item) => item.clienteNome).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'pt-BR'))
    return [{ value: '', label: 'Todos os clientes' }, ...names.map((name) => ({ value: name, label: name }))]
  }, [items])

  const contratoFilterOptions = useMemo<CommandSelectOption[]>(() => {
    const filtered = cliente ? items.filter((item) => item.clienteNome === cliente) : items
    const seen = new Set<string>()
    const options: CommandSelectOption[] = [{ value: '', label: 'Todos os contratos' }]
    for (const item of filtered) {
      const key = `${item.contratoNumero || ''}-${item.contratoNome}`
      if (seen.has(key)) continue
      seen.add(key)
      options.push({
        value: item.contratoNome,
        label: item.contratoNumero ? `${item.contratoNumero} - ${item.contratoNome}` : item.contratoNome,
        group: item.clienteNome,
      })
    }
    return options
  }, [items, cliente])

  const casoFilterOptions = useMemo<CommandSelectOption[]>(() => {
    let filtered = items
    if (cliente) filtered = filtered.filter((item) => item.clienteNome === cliente)
    if (contrato) filtered = filtered.filter((item) => item.contratoNome === contrato)
    const seen = new Set<string>()
    const options: CommandSelectOption[] = [{ value: '', label: 'Todos os casos' }]
    for (const item of filtered) {
      const key = `${item.casoNumero || ''}-${item.casoNome}`
      if (seen.has(key)) continue
      seen.add(key)
      options.push({
        value: item.casoNome,
        label: item.casoNumero ? `${item.casoNumero} - ${item.casoNome}` : item.casoNome,
        group: item.contratoNumero ? `${item.contratoNumero} - ${item.contratoNome}` : item.contratoNome,
      })
    }
    return options
  }, [items, cliente, contrato])

  const caseOptions = useMemo<CommandSelectOption[]>(() => {
    const seen = new Set<string>()
    const options: CommandSelectOption[] = []

    for (const contrato of allContratos) {
      const contratoLabel = (() => {
        const numero = contrato.numero_sequencial ?? contrato.numero ?? null
        const nome = contrato.nome_contrato || 'Contrato sem nome'
        const cliente = contrato.cliente_nome ? ` — ${contrato.cliente_nome}` : ''
        return numero ? `${numero} - ${nome}${cliente}` : `${nome}${cliente}`
      })()
      for (const caso of contrato.casos || []) {
        if (!caso?.id || seen.has(caso.id)) continue
        seen.add(caso.id)
        options.push({
          value: caso.id,
          label: caso.numero ? `${caso.numero} - ${caso.nome}` : caso.nome,
          group: contratoLabel,
        })
      }
    }

    for (const item of items) {
      if (!item.casoId || seen.has(item.casoId)) continue
      seen.add(item.casoId)
      options.push({
        value: item.casoId,
        label: item.casoNumero ? `${item.casoNumero} - ${item.casoNome}` : item.casoNome,
        group: item.contratoNumero ? `${item.contratoNumero} - ${item.contratoNome}` : item.contratoNome,
      })
    }

    return options
  }, [allContratos, items])

  const caseLabelById = useMemo(() => new Map(caseOptions.map((option) => [option.value, option.label])), [caseOptions])

  const colaboradorOptions = useMemo<CommandSelectOption[]>(() => {
    const seen = new Set<string>()
    const options: CommandSelectOption[] = []
    for (const colaborador of colaboradores) {
      if (!colaborador.nome || seen.has(colaborador.nome)) continue
      seen.add(colaborador.nome)
      options.push({ value: colaborador.nome, label: colaborador.nome })
    }
    return options
  }, [colaboradores])

  const getLiveItemHours = useCallback((item: RevisaoItem, mode: ReviewMode) => {
    const draft = drafts[item.id]
    if (!draft) return getEffectiveItemHours(item)
    if (mode === 'timesheet') {
      return draft.timesheetRows.reduce((acc, row) => acc + parseDecimalInput(row.horasRevisadas || row.horasIniciais), 0)
    }
    return parseDecimalInput(draft.horas || String(getEffectiveItemHours(item)))
  }, [drafts])

  const getLiveItemValue = useCallback((item: RevisaoItem, mode: ReviewMode) => {
    const draft = drafts[item.id]
    if (!draft) return getEffectiveItemValue(item)
    if (mode === 'timesheet') {
      return draft.timesheetRows.reduce(
        (acc, row) => acc + parseDecimalInput(row.horasRevisadas || row.horasIniciais) * parseDecimalInput(row.valorHora),
        0,
      )
    }
    return draft.valueRows.length > 0
      ? draft.valueRows.reduce((acc, row) => acc + parseDecimalInput(row.valorRevisado), 0)
      : parseDecimalInput(draft.valor || String(getEffectiveItemValue(item)))
  }, [drafts])

  const getLiveCaseMetrics = useCallback((casoGroup: CasoGroup): CaseMetrics => {
    const baseMetrics = getCaseBaseMetrics(casoGroup)
    const timesheetHours = baseMetrics.timesheetItems.reduce((acc, item) => acc + getLiveItemHours(item, 'timesheet'), 0)
    const timesheetValue = baseMetrics.timesheetItems.reduce((acc, item) => acc + getLiveItemValue(item, 'timesheet'), 0)
    const nonTimesheetHours = baseMetrics.nonTimesheetItems.reduce((acc, item) => acc + getLiveItemHours(item, 'default'), 0)
    const nonTimesheetValue = baseMetrics.nonTimesheetItems.reduce((acc, item) => acc + getLiveItemValue(item, 'default'), 0)

    return {
      totalHoras: nonTimesheetHours + timesheetHours,
      totalValor: nonTimesheetValue + timesheetValue,
      itemCount: baseMetrics.itemCount,
      timesheetItems: baseMetrics.timesheetItems,
      nonTimesheetItems: baseMetrics.nonTimesheetItems,
    }
  }, [getLiveItemHours, getLiveItemValue])

  const getReviewRows = useCallback((casoGroup: CasoGroup) => {
    const metrics = getLiveCaseMetrics(casoGroup)
    const rows: Array<{ item: RevisaoItem; mode: ReviewMode; key: string }> = []
    // Valor da regra primeiro (o que é cobrado); horas embaixo, para validação.
    for (const item of metrics.nonTimesheetItems) {
      rows.push({
        item,
        mode: 'default',
        key: `default:${item.id}`,
      })
    }
    // cada lançamento de hora enviado é um bloco revisável próprio
    for (const item of metrics.timesheetItems) {
      rows.push({
        item,
        mode: 'timesheet',
        key: `timesheet:${item.id}`,
      })
    }
    return rows
  }, [getLiveCaseMetrics])

  const allRows = useMemo(() => {
    const rows: Array<{ item: RevisaoItem; mode: ReviewMode; key: string }> = []
    for (const clienteGroup of fullTree) {
      for (const casoGroup of clienteGroup.casos) {
        rows.push(...getReviewRows(casoGroup))
      }
    }
    return rows
  }, [fullTree, getReviewRows])

  const ruleButtons = useMemo(() => {
    const counts = new Map<RuleFilterKey, number>()
    for (const row of allRows) {
      const key = getRuleFilterKey(row.item)
      if (!key) continue
      counts.set(key, (counts.get(key) || 0) + 1)
    }

    const orderedKeys: RuleFilterKey[] = [
      'hora',
      'mensalidade_processo',
      'mensalidade',
      'projeto',
      'projeto_parcelado',
      'exito',
      'despesa',
    ]
    return [
      { key: 'all' as RuleFilterKey, label: getRuleFilterLabel('all'), count: allRows.length },
      ...orderedKeys.map((key) => ({ key, label: getRuleFilterLabel(key), count: counts.get(key) || 0 })),
    ]
  }, [allRows])

  const totals = useMemo(() => {
    return tree.reduce(
      (acc, clienteGroup) => {
        for (const casoGroup of clienteGroup.casos) {
          const metrics = getLiveCaseMetrics(casoGroup)
          acc.horas += metrics.totalHoras
          acc.valor += metrics.totalValor
          acc.itens += metrics.itemCount
        }
        return acc
      },
      { horas: 0, valor: 0, itens: 0 },
    )
  }, [tree, getLiveCaseMetrics])


  const syncTimesheetRow = (itemId: string, rowId: string, patch: Partial<TimesheetRowDraft>) => {
    setDrafts((prev) => {
      const current = prev[itemId]
      if (!current) return prev
      const nextRows = current.timesheetRows.map((row) => (row.id === rowId ? { ...row, ...patch } : row))
      const totalHoras = nextRows.reduce((acc, row) => acc + parseDecimalInput(row.horasRevisadas || row.horasIniciais), 0)
      const totalValor = nextRows.reduce(
        (acc, row) => acc + parseDecimalInput(row.horasRevisadas || row.horasIniciais) * parseDecimalInput(row.valorHora),
        0,
      )
      return {
        ...prev,
        [itemId]: {
          ...current,
          horas: String(totalHoras),
          valor: String(totalValor),
          timesheetRows: nextRows,
        },
      }
    })
  }

  const syncValueRow = (itemId: string, rowId: string, patch: Partial<ValueRowDraft>) => {
    setDrafts((prev) => {
      const current = prev[itemId]
      if (!current) return prev
      const nextRows = current.valueRows.map((row) => (row.id === rowId ? { ...row, ...patch } : row))
      const totalValor = nextRows.reduce((acc, row) => acc + parseDecimalInput(row.valorRevisado), 0)
      return {
        ...prev,
        [itemId]: {
          ...current,
          valor: String(totalValor),
          valueRows: nextRows,
        },
      }
    })
  }

  const updateItemCase = async (itemId: string, casoId: string) => {
    const accessToken = await getSessionToken()
    if (!accessToken) return false

    const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/update-faturamento-item`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        id: itemId,
        caso_id: casoId,
      }),
    })

    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      toastError(payload.error || 'Erro ao atualizar caso do item')
      return false
    }
    return true
  }

  const saveReviewItem = async (item: RevisaoItem, mode: ReviewMode) => {
    const draft = drafts[item.id]
    if (!draft) return false

    try {
      setBusyKey(`${mode}:${item.id}`)
      const accessToken = await getSessionToken()
      if (!accessToken) return false

      const body: Record<string, unknown> = {
        billing_item_id: item.id,
        observacao: draft.observacao || null,
        snapshot_patch:
          mode === 'timesheet'
            ? {
                timesheet_itens_revisao: draft.timesheetRows.map((row) => ({
                  id: row.id,
                  caso_id: draft.casoId || item.casoId,
                  contrato_id: item.contratoId,
                  data_lancamento: row.dataLancamento || null,
                  profissional: row.profissional || '',
                  atividade: row.atividade || '',
                  horas_iniciais: parseDecimalInput(row.horasIniciais),
                  horas_revisadas: parseDecimalInput(row.horasRevisadas || row.horasIniciais),
                  valor_hora_inicial: parseDecimalInput(row.valorHoraInicial),
                  valor_hora: parseDecimalInput(row.valorHora),
                })),
              }
            : {
                valor_itens_revisao: draft.valueRows.map((row) => ({
                  id: row.id,
                  referencia: normalizeDateFromDisplay(row.referencia || '') || null,
                  descricao: row.descricao || '',
                  valor_original: parseDecimalInput(row.valorOriginal),
                  valor_revisado: parseDecimalInput(row.valorRevisado),
                })),
                profissional_revisado: draft.profissional || '',
              },
      }

      const liveHours = getLiveItemHours(item, mode)
      const liveValue = getLiveItemValue(item, mode)
      if (item.status === 'em_aprovacao') {
        body.horas_aprovadas = liveHours
        body.valor_aprovado = liveValue
      } else {
        body.horas_revisadas = liveHours
        body.valor_revisado = liveValue
      }

      const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/update-revisao-fatura-item`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })

      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        toastError(payload.error || 'Erro ao salvar item da revisão')
        return false
      }

      if (draft.casoId && draft.casoId !== item.casoId) {
        const moved = await updateItemCase(item.id, draft.casoId)
        if (!moved) return false
      }

      success('Revisão salva com sucesso.')
      // atualização silenciosa: a tela não some/recarrega no meio da revisão
      void loadItems({ silent: true })
      return true
    } catch (saveError) {
      console.error(saveError)
      toastError('Erro ao salvar item da revisão')
      return false
    } finally {
      setBusyKey(null)
    }
  }

  const advanceItem = async (item: RevisaoItem) => {
    try {
      setBusyKey(`advance:${item.id}`)
      const accessToken = await getSessionToken()
      if (!accessToken) return false

      const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/set-revisao-fatura-status`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          billing_item_id: item.id,
          action: 'avancar',
        }),
      })

      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        toastError(payload.error || 'Erro ao avançar item')
        return false
      }

      success('Item avançado com sucesso.')
      // avanço otimista: status muda na hora, refetch em silêncio por trás
      setItems((prev) =>
        prev.map((entry) =>
          entry.id === item.id
            ? { ...entry, status: entry.status === 'em_revisao' ? 'em_aprovacao' : 'aprovado' }
            : entry,
        ),
      )
      void loadItems({ silent: true })
      return true
    } catch (advanceError) {
      console.error(advanceError)
      toastError('Erro ao avançar item')
      return false
    } finally {
      setBusyKey(null)
    }
  }

  const saveAndAdvance = async (item: RevisaoItem, mode: ReviewMode) => {
    const saved = await saveReviewItem(item, mode)
    if (!saved) return false
    return advanceItem(item)
  }

  // "Revisar selecionados · OK": conclui a revisão sem alterações dos itens marcados.
  const reviewSelectedOk = async (scopeKey: string, itemIds: string[]) => {
    const uniqueIds = Array.from(new Set(itemIds))
    if (uniqueIds.length === 0) {
      toastError('Nenhum item selecionado para revisão.')
      return
    }
    let successCount = 0
    let failCount = 0
    try {
      setBusyKey(scopeKey)
      for (const itemId of uniqueIds) {
        const item = items.find((entry) => entry.id === itemId)
        if (!item || item.status !== 'em_revisao') {
          failCount += 1
          continue
        }
        const ok = await advanceItem(item)
        if (ok) successCount += 1
        else failCount += 1
      }
      setSelectedItemIds((prev) => prev.filter((id) => !uniqueIds.includes(id)))
      if (successCount > 0) success(`${successCount} item(ns) revisado(s) sem alterações.`)
      if (failCount > 0) toastError(`${failCount} item(ns) não puderam ser revisados.`)
    } finally {
      setBusyKey(null)
    }
  }

  const approveSelected = async (scopeKey: string, itemIds: string[]) => {
    const uniqueIds = Array.from(new Set(itemIds))
    if (uniqueIds.length === 0) {
      toastError('Nenhum item selecionado para aprovação em lote.')
      return
    }

    let successCount = 0
    let failCount = 0

    try {
      setBusyKey(scopeKey)
      for (const itemId of uniqueIds) {
        const item = items.find((entry) => entry.id === itemId)
        if (!item) {
          failCount += 1
          continue
        }
        const mode: ReviewMode = item.origemTipo === 'timesheet' ? 'timesheet' : 'default'
        const ok = await saveAndAdvance(item, mode)
        if (ok) successCount += 1
        else failCount += 1
      }

      setSelectedItemIds((prev) => prev.filter((id) => !uniqueIds.includes(id)))

      if (successCount > 0) success(`${successCount} item(ns) aprovado(s) em lote.`)
      if (failCount > 0) toastError(`${failCount} item(ns) não puderam ser aprovados.`)
    } finally {
      setBusyKey(null)
    }
  }

  const postergarItem = async (item: RevisaoItem) => {
    try {
      setBusyKey(`postergar:${item.id}`)
      const accessToken = await getSessionToken()
      if (!accessToken) return false

      const proximoMes = getNextBillingPeriodDate(item)
      const periodoFaturamento = proximoMes.toISOString().slice(0, 10)

      const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/update-timesheet`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id: item.timesheetId,
          periodo_faturamento: periodoFaturamento,
        }),
      })

      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        toastError(payload.error || 'Erro ao postergar item')
        return false
      }

      success(`Item postergado para ${proximoMes.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}.`)
      await loadItems()
      return true
    } catch (postergarError) {
      console.error(postergarError)
      toastError('Erro ao postergar item')
      return false
    } finally {
      setBusyKey(null)
    }
  }

  if (!canRead) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4">
        <p className="text-sm text-destructive">Você não tem permissão para visualizar a revisão de faturamento.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {error ? (
        <Alert className="border border-destructive/30 bg-destructive/10 text-destructive">
          <AlertTitle>Atenção</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-wrap gap-2 rounded-xl border bg-white p-3">
        {ruleButtons.map((button) => (
          <button
            key={button.key}
            type="button"
            onClick={() => setRuleFilter(button.key)}
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm transition-colors ${
              ruleFilter === button.key
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-hairline bg-canvas-soft text-ink-secondary hover:border-hairline'
            }`}
          >
            <span>{button.label}</span>
            <span className={`rounded-full px-2 py-0.5 text-xs ${ruleFilter === button.key ? 'bg-white/20 text-white' : 'bg-white text-ink-mute'}`}>
              {button.count}
            </span>
          </button>
        ))}
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <div className="space-y-1">
          <label className="text-sm font-medium">Cliente</label>
          <CommandSelect
            value={cliente}
            onValueChange={(value) => {
              setCliente(value)
              setContrato('')
              setCaso('')
            }}
            options={clienteFilterOptions}
            placeholder="Selecione o cliente"
            searchPlaceholder="Buscar cliente..."
            emptyText="Nenhum cliente encontrado."
          />
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium">Contrato</label>
          <CommandSelect
            value={contrato}
            onValueChange={(value) => {
              setContrato(value)
              setCaso('')
            }}
            options={contratoFilterOptions}
            placeholder="Selecione o contrato"
            searchPlaceholder="Buscar contrato..."
            emptyText="Nenhum contrato encontrado."
          />
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium">Caso</label>
          <CommandSelect
            value={caso}
            onValueChange={setCaso}
            options={casoFilterOptions}
            placeholder="Selecione o caso"
            searchPlaceholder="Buscar caso..."
            emptyText="Nenhum caso encontrado."
          />
        </div>
        <div className="flex items-end justify-end">
          <Button onClick={() => void loadItems()} disabled={loading}>
            {loading ? 'Atualizando...' : 'Aplicar filtros'}
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between rounded-md border bg-muted/30 p-3 text-sm">
        <div className="text-muted-foreground">
          <span className="mr-4">
            Itens: <strong className="text-foreground">{totals.itens}</strong>
          </span>
          <span className="mr-4">
            Horas: <strong className="text-foreground">{formatHours(totals.horas)}</strong>
          </span>
          <span>
            {statusSummary.revisao} aguarda(m) revisão · {statusSummary.aprovacao} aguarda(m) aprovação · {statusSummary.aprovado} aprovado(s)
          </span>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={toggleAllExpanded}>
            {allExpanded ? 'Recolher tudo' : 'Expandir tudo'}
          </Button>
          <div className="font-semibold font-tabular">{formatMoney(totals.valor)}</div>
        </div>
      </div>

      {loading ? (
        <div className="rounded-xl border bg-white p-8 text-center text-sm text-muted-foreground">
          Carregando revisão de fatura...
        </div>
      ) : tree.length === 0 ? (
        <div className="rounded-xl border bg-white p-8 text-center text-sm text-muted-foreground">
          Nenhum item em revisão encontrado para os filtros informados.
        </div>
      ) : (
        <div className="space-y-5">
          {tree.map((clienteGroup) => {
            const clienteExpanded = expandedClientes[clienteGroup.key] ?? allExpanded
            const clienteTotals = clienteGroup.casos.reduce(
              (acc, casoGroup) => {
                const metrics = getLiveCaseMetrics(casoGroup)
                acc.horas += metrics.totalHoras
                acc.valor += metrics.totalValor
                acc.itens += metrics.itemCount
                return acc
              },
              { horas: 0, valor: 0, itens: 0 },
            )

            return (
              <section key={clienteGroup.key} className="overflow-hidden rounded-2xl border bg-white shadow-sm">
                <div className="border-b bg-canvas-soft px-4 py-3">
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-3 text-left"
                    onClick={() => setExpandedClientes((prev) => ({ ...prev, [clienteGroup.key]: !clienteExpanded }))}
                  >
                    <div className="flex items-center gap-2">
                      {clienteExpanded ? <ChevronDown className="h-4 w-4 text-ink-mute" /> : <ChevronRight className="h-4 w-4 text-ink-mute" />}
                      <div>
                        <p className="text-sm font-semibold text-ink">{clienteGroup.nome}</p>
                        <p className="text-xs text-ink-mute">
                          {clienteTotals.itens} item(ns) · {formatHours(clienteTotals.horas)} h
                        </p>
                      </div>
                    </div>
                    <p className="text-sm font-semibold text-ink font-tabular">{formatMoney(clienteTotals.valor)}</p>
                  </button>
                </div>

                {clienteExpanded ? (
                  <div className="space-y-4 p-4">
                    {clienteGroup.casos.map((casoGroup) => {
                      const casoExpanded = expandedCasos[casoGroup.key] ?? allExpanded
                      const caseMetrics = getLiveCaseMetrics(casoGroup)
                      const reviewRows = getReviewRows(casoGroup)
                      const caseRowIds = reviewRows.filter((row) => canAdvance(row.item.status)).map((row) => row.item.id)
                      const allSelected = caseRowIds.length > 0 && caseRowIds.every((id) => selectedItemIds.includes(id))
                      const selectedIds = caseRowIds.filter((id) => selectedItemIds.includes(id))
                      const batchKey = `batch:${clienteGroup.key}:${casoGroup.key}`

                      return (
                        <div key={casoGroup.key} className="rounded-xl border border-hairline">
                          <div className="border-b bg-white px-4 py-3">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <button
                                type="button"
                                className="flex items-center gap-2 text-left"
                                onClick={() => setExpandedCasos((prev) => ({ ...prev, [casoGroup.key]: !casoExpanded }))}
                              >
                                {casoExpanded ? <ChevronDown className="h-4 w-4 text-ink-mute" /> : <ChevronRight className="h-4 w-4 text-ink-mute" />}
                                <div>
                                  <p className="text-sm font-semibold text-ink">
                                    {casoGroup.numero ? `${casoGroup.numero} - ` : ''}
                                    {casoGroup.nome}
                                  </p>
                                  <p className="text-xs text-ink-mute">
                                    {caseMetrics.itemCount} item(ns) · {formatHours(caseMetrics.totalHoras)} h
                                  </p>
                                </div>
                              </button>

                              <div className="flex flex-wrap items-center gap-3">
                                <label className="flex items-center gap-2 text-xs text-ink-mute">
                                  <input
                                    type="checkbox"
                                    className="h-4 w-4 rounded border-hairline"
                                    checked={allSelected}
                                    onChange={(event) => {
                                      const checked = event.target.checked
                                      setSelectedItemIds((prev) =>
                                        checked
                                          ? Array.from(new Set([...prev, ...caseRowIds]))
                                          : prev.filter((id) => !caseRowIds.includes(id)),
                                      )
                                    }}
                                  />
                                  Selecionar todos
                                </label>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => void reviewSelectedOk(batchKey, selectedIds)}
                                  disabled={selectedIds.length === 0 || busyKey === batchKey}
                                >
                                  {busyKey === batchKey ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                  Revisar selecionados · OK
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => void approveSelected(batchKey, selectedIds)}
                                  disabled={selectedIds.length === 0 || busyKey === batchKey}
                                >
                                  Aprovar selecionados
                                </Button>
                                <p className="text-sm font-semibold text-ink font-tabular">{formatMoney(caseMetrics.totalValor)}</p>
                              </div>
                            </div>
                          </div>

                          {casoExpanded ? (
                            <div className="space-y-3 bg-canvas-soft/40 p-3">
                              {reviewRows.map(({ item, mode, key }) => {
                                const draft = drafts[item.id]
                                const busy = busyKey === key || busyKey === `advance:${item.id}` || busyKey === batchKey || busyKey === `${mode}:${item.id}`
                                const isEditing = editorKey === key
                                const badge =
                                  item.status === 'em_revisao'
                                    ? { label: 'Aguarda revisão', cls: 'bg-amber-100 text-amber-800' }
                                    : item.status === 'em_aprovacao'
                                      ? { label: 'Aguarda aprovação', cls: 'bg-indigo-100 text-indigo-700' }
                                      : { label: 'Aprovado', cls: 'bg-emerald-100 text-emerald-700' }
                                const envioData = item.timesheetDataLancamento || item.dataReferencia
                                const envioTexto = mode === 'timesheet' ? item.timesheetDescricao || 'Sem descrição' : getRuleTitle(item)
                                const revisado = item.status === 'em_aprovacao' || item.status === 'aprovado'
                                const revChanges = getStageChanges(item, 'REVISOR')
                                const aprChanges = getStageChanges(item, 'APROVADOR')
                                const tsRow = draft?.timesheetRows?.[0]
                                const tsHorasValor = parseDecimalInput(tsRow?.horasRevisadas || tsRow?.horasIniciais || '0')
                                const tsHoras = Math.floor(tsHorasValor)
                                const tsMinutos = Math.round((tsHorasValor - tsHoras) * 60)

                                return (
                                  <div key={key} className="overflow-hidden rounded-xl border border-hairline bg-white shadow-sm">
                                    <div className="flex flex-wrap items-center gap-2 border-b border-hairline px-3 py-2">
                                      <input
                                        type="checkbox"
                                        className="h-4 w-4 rounded border-hairline"
                                        checked={selectedItemIds.includes(item.id)}
                                        onChange={(event) =>
                                          setSelectedItemIds((prev) =>
                                            event.target.checked
                                              ? Array.from(new Set([...prev, item.id]))
                                              : prev.filter((id) => id !== item.id),
                                          )
                                        }
                                        disabled={!canAdvance(item.status) || busy}
                                      />
                                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${badge.cls}`}>{badge.label}</span>
                                      <span className="text-xs text-ink-mute">
                                        Lançado por <strong className="text-ink-secondary">{item.enviadoPorNome || item.timesheetProfissional || '-'}</strong>
                                        {envioData ? ` em ${formatDate(envioData)}` : ''}
                                      </span>
                                    </div>

                                    <Table className="min-w-[980px]">
                                      <thead className="bg-white">
                                        <tr className="border-b text-[11px] uppercase tracking-wide text-ink-mute">
                                          <th className="px-3 py-2 text-left">Etapa</th>
                                          <th className="px-3 py-2 text-left">Responsável</th>
                                          <th className="px-3 py-2 text-left">Data</th>
                                          <th className="px-3 py-2 text-left">Texto</th>
                                          <th className="px-3 py-2 text-right">Horas</th>
                                          <th className="px-3 py-2 text-right">Valor</th>
                                          <th className="px-3 py-2 text-right">Ações</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {/* ENVIO */}
                                        <tr className="border-b align-top">
                                          <td className="px-3 py-3">
                                            <span className="rounded-full bg-canvas-soft px-2 py-1 text-xs text-ink-secondary">Envio</span>
                                          </td>
                                          <td className="px-3 py-3 text-sm text-ink-secondary">{item.enviadoPorNome || item.timesheetProfissional || '-'}</td>
                                          <td className="px-3 py-3 text-sm text-ink-secondary">{envioData ? formatDate(envioData) : '—'}</td>
                                          <td className="px-3 py-3 text-sm text-ink-secondary">
                                            <div className="max-w-[420px] whitespace-normal break-words">{envioTexto}</div>
                                          </td>
                                          <td className="px-3 py-3 text-right text-sm text-ink-secondary font-tabular">
                                            {mode === 'timesheet' ? formatHistoryHours(getOriginalItemHours(item)) : '—'}
                                          </td>
                                          <td className="px-3 py-3 text-right text-sm font-medium text-ink font-tabular">{formatMoney(getOriginalItemValue(item))}</td>
                                          <td className="px-3 py-3" />
                                        </tr>

                                        {/* REVISÃO */}
                                        <tr className="border-b bg-emerald-50/50 align-top">
                                          <td className="px-3 py-3">
                                            <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs text-emerald-700">Revisão</span>
                                          </td>
                                          <td className="px-3 py-3 text-sm text-ink-secondary">{item.responsavelRevisaoNome || 'Sem revisor definido'}</td>
                                          <td className="px-3 py-3 text-sm text-ink-secondary">{revisado && item.dataRevisao ? formatDate(item.dataRevisao) : '—'}</td>
                                          <td className="px-3 py-3 text-sm text-ink-secondary">
                                            {revisado ? (
                                              <div className="max-w-[420px] space-y-1 whitespace-normal break-words">
                                                <div>{revChanges?.texto || envioTexto}</div>
                                                <StageTag alterado={Boolean(revChanges?.alterado)} changes={revChanges?.changes || []} />
                                              </div>
                                            ) : (
                                              <span className="italic text-ink-mute">Aguardando sua revisão do lançamento acima.</span>
                                            )}
                                          </td>
                                          <td className="px-3 py-3 text-right text-sm text-ink-secondary font-tabular">
                                            {revisado && mode === 'timesheet' ? formatHistoryHours(item.horasRevisadas ?? getOriginalItemHours(item)) : revisado ? '—' : ''}
                                          </td>
                                          <td className="px-3 py-3 text-right text-sm font-medium text-ink font-tabular">
                                            {revisado ? formatMoney(item.valorRevisado ?? getOriginalItemValue(item)) : ''}
                                          </td>
                                          <td className="px-3 py-3">
                                            {item.status === 'em_revisao' ? (
                                              <div className="flex flex-wrap items-center justify-end gap-2">
                                                <Button
                                                  size="sm"
                                                  className="bg-emerald-600 text-white hover:bg-emerald-700"
                                                  onClick={() => void advanceItem(item)}
                                                  disabled={busy}
                                                >
                                                  {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                                  ✓ OK, sem alterações
                                                </Button>
                                                <Button
                                                  size="sm"
                                                  variant="outline"
                                                  onClick={() => setEditorKey((current) => (current === key ? null : key))}
                                                  disabled={busy}
                                                >
                                                  Revisar
                                                </Button>
                                                {item.timesheetId ? (
                                                  <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    className="text-primary hover:bg-primary-soft-bg hover:text-primary-deep"
                                                    onClick={() => setPostergarConfirmId(item.id)}
                                                    disabled={busy}
                                                  >
                                                    <Clock className="mr-1 h-3.5 w-3.5" /> Reagendar timesheet
                                                  </Button>
                                                ) : null}
                                              </div>
                                            ) : null}
                                          </td>
                                        </tr>

                                        {isEditing && item.status === 'em_revisao' ? (
                                          <tr className="border-b bg-canvas-soft/60">
                                            <td colSpan={7} className="px-4 py-3">
                                              <div className="space-y-3 rounded-lg border bg-white p-4">
                                                {mode === 'timesheet' && tsRow ? (
                                                  <>
                                                    <Textarea
                                                      value={tsRow.atividade}
                                                      onChange={(event) => syncTimesheetRow(item.id, tsRow.id, { atividade: event.target.value })}
                                                      rows={3}
                                                      disabled={busy}
                                                    />
                                                    <div className="flex flex-wrap items-end gap-4">
                                                      <div className="flex items-center gap-2">
                                                        <span className="text-sm text-ink-mute">Horas:</span>
                                                        <Input
                                                          className="w-16 text-right"
                                                          inputMode="numeric"
                                                          value={String(tsHoras)}
                                                          onChange={(event) => {
                                                            const h = Math.max(0, parseInt(event.target.value || '0', 10) || 0)
                                                            syncTimesheetRow(item.id, tsRow.id, { horasRevisadas: String(h + tsMinutos / 60) })
                                                          }}
                                                          disabled={busy}
                                                        />
                                                        <span className="text-sm text-ink-mute">h</span>
                                                        <Input
                                                          className="w-16 text-right"
                                                          inputMode="numeric"
                                                          value={String(tsMinutos)}
                                                          onChange={(event) => {
                                                            const m = Math.min(59, Math.max(0, parseInt(event.target.value || '0', 10) || 0))
                                                            syncTimesheetRow(item.id, tsRow.id, { horasRevisadas: String(tsHoras + m / 60) })
                                                          }}
                                                          disabled={busy}
                                                        />
                                                        <span className="text-sm text-ink-mute">min</span>
                                                      </div>
                                                      <div className="flex items-center gap-2">
                                                        <span className="text-sm text-ink-mute">Profissional:</span>
                                                        <select
                                                          className="h-9 rounded-md border border-hairline-input bg-background px-2 text-sm text-ink"
                                                          value={tsRow.profissional}
                                                          onChange={(event) => syncTimesheetRow(item.id, tsRow.id, { profissional: event.target.value })}
                                                          disabled={busy}
                                                        >
                                                          {tsRow.profissional && !colaboradores.some((c) => c.nome === tsRow.profissional) ? (
                                                            <option value={tsRow.profissional}>{tsRow.profissional}</option>
                                                          ) : null}
                                                          {colaboradores.map((colab) => (
                                                            <option key={colab.id} value={colab.nome}>
                                                              {colab.nome}
                                                            </option>
                                                          ))}
                                                        </select>
                                                      </div>
                                                    </div>
                                                  </>
                                                ) : (
                                                  <>
                                                    <Textarea
                                                      value={draft?.valueRows?.[0]?.descricao || ''}
                                                      onChange={(event) => {
                                                        if (draft?.valueRows?.[0]) {
                                                          syncValueRow(item.id, draft.valueRows[0].id, { descricao: event.target.value })
                                                        }
                                                      }}
                                                      rows={3}
                                                      disabled={busy}
                                                    />
                                                    <div className="flex items-center gap-2">
                                                      <span className="text-sm text-ink-mute">Valor (R$):</span>
                                                      <Input
                                                        className="w-36 text-right"
                                                        value={draft?.valueRows?.[0]?.valorRevisado || draft?.valor || ''}
                                                        onChange={(event) => {
                                                          updateDraft(item.id, { valor: event.target.value })
                                                          if (draft?.valueRows?.[0]) {
                                                            syncValueRow(item.id, draft.valueRows[0].id, { valorRevisado: event.target.value })
                                                          }
                                                        }}
                                                        disabled={busy}
                                                      />
                                                    </div>
                                                  </>
                                                )}
                                                <div className="flex items-center justify-end gap-2">
                                                  <Button size="sm" variant="ghost" onClick={() => setEditorKey(null)} disabled={busy}>
                                                    Cancelar
                                                  </Button>
                                                  <Button
                                                    size="sm"
                                                    className="bg-emerald-600 text-white hover:bg-emerald-700"
                                                    onClick={() => {
                                                      setEditorKey(null)
                                                      void saveAndAdvance(item, mode)
                                                    }}
                                                    disabled={busy}
                                                  >
                                                    Salvar revisão
                                                  </Button>
                                                </div>
                                              </div>
                                            </td>
                                          </tr>
                                        ) : null}

                                        {/* APROVAÇÃO */}
                                        <tr className="bg-indigo-50/40 align-top">
                                          <td className="px-3 py-3">
                                            <span className="rounded-full bg-indigo-100 px-2 py-1 text-xs text-indigo-700">Aprovação</span>
                                          </td>
                                          <td className="px-3 py-3 text-sm text-ink-secondary">{item.responsavelAprovacaoNome || 'Renata ou Douglas'}</td>
                                          <td className="px-3 py-3 text-sm text-ink-secondary">
                                            {item.status === 'aprovado' && item.dataAprovacao ? formatDate(item.dataAprovacao) : '—'}
                                          </td>
                                          <td className="px-3 py-3 text-sm text-ink-secondary">
                                            {item.status === 'aprovado' ? (
                                              <div className="max-w-[420px] space-y-1 whitespace-normal break-words">
                                                <div>{aprChanges?.texto || revChanges?.texto || envioTexto}</div>
                                                <StageTag alterado={Boolean(aprChanges?.alterado)} changes={aprChanges?.changes || []} />
                                              </div>
                                            ) : item.status === 'em_aprovacao' ? (
                                              <span className="italic text-ink-secondary">Revisão concluída — disponível para aprovar.</span>
                                            ) : (
                                              <span className="italic text-ink-mute">🔒 Disponível após a revisão.</span>
                                            )}
                                          </td>
                                          <td className="px-3 py-3 text-right text-sm text-ink-secondary font-tabular">
                                            {item.status === 'aprovado' && mode === 'timesheet'
                                              ? formatHistoryHours(item.horasAprovadas ?? item.horasRevisadas ?? getOriginalItemHours(item))
                                              : ''}
                                          </td>
                                          <td className="px-3 py-3 text-right text-sm font-medium text-ink font-tabular">
                                            {item.status === 'aprovado' ? formatMoney(item.valorAprovado ?? item.valorRevisado ?? getOriginalItemValue(item)) : ''}
                                          </td>
                                          <td className="px-3 py-3">
                                            {item.status === 'em_aprovacao' ? (
                                              <div className="flex flex-wrap items-center justify-end gap-2">
                                                <Button
                                                  size="sm"
                                                  className="bg-indigo-600 text-white hover:bg-indigo-700"
                                                  onClick={() => void advanceItem(item)}
                                                  disabled={busy}
                                                >
                                                  {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                                  ✓ OK, sem alterações
                                                </Button>
                                                <Button
                                                  size="sm"
                                                  variant="outline"
                                                  onClick={() => setEditorKey((current) => (current === `apr:${key}` ? null : `apr:${key}`))}
                                                  disabled={busy}
                                                >
                                                  Alterar
                                                </Button>
                                              </div>
                                            ) : item.status === 'em_revisao' ? (
                                              <div className="flex flex-wrap items-center justify-end gap-2 opacity-50">
                                                <Button size="sm" variant="outline" disabled>
                                                  ✓ OK, sem alterações
                                                </Button>
                                                <Button size="sm" variant="ghost" disabled>
                                                  Alterar
                                                </Button>
                                              </div>
                                            ) : null}
                                          </td>
                                        </tr>

                                        {editorKey === `apr:${key}` && item.status === 'em_aprovacao' ? (
                                          <tr className="border-t bg-canvas-soft/60">
                                            <td colSpan={7} className="px-4 py-3">
                                              <div className="space-y-3 rounded-lg border bg-white p-4">
                                                {mode === 'timesheet' && tsRow ? (
                                                  <>
                                                    <Textarea
                                                      value={tsRow.atividade}
                                                      onChange={(event) => syncTimesheetRow(item.id, tsRow.id, { atividade: event.target.value })}
                                                      rows={3}
                                                      disabled={busy}
                                                    />
                                                    <div className="flex items-center gap-2">
                                                      <span className="text-sm text-ink-mute">Horas:</span>
                                                      <Input
                                                        className="w-16 text-right"
                                                        inputMode="numeric"
                                                        value={String(tsHoras)}
                                                        onChange={(event) => {
                                                          const h = Math.max(0, parseInt(event.target.value || '0', 10) || 0)
                                                          syncTimesheetRow(item.id, tsRow.id, { horasRevisadas: String(h + tsMinutos / 60) })
                                                        }}
                                                        disabled={busy}
                                                      />
                                                      <span className="text-sm text-ink-mute">h</span>
                                                      <Input
                                                        className="w-16 text-right"
                                                        inputMode="numeric"
                                                        value={String(tsMinutos)}
                                                        onChange={(event) => {
                                                          const m = Math.min(59, Math.max(0, parseInt(event.target.value || '0', 10) || 0))
                                                          syncTimesheetRow(item.id, tsRow.id, { horasRevisadas: String(tsHoras + m / 60) })
                                                        }}
                                                        disabled={busy}
                                                      />
                                                      <span className="text-sm text-ink-mute">min</span>
                                                    </div>
                                                  </>
                                                ) : (
                                                  <>
                                                    <Textarea
                                                      value={draft?.valueRows?.[0]?.descricao || ''}
                                                      onChange={(event) => {
                                                        if (draft?.valueRows?.[0]) {
                                                          syncValueRow(item.id, draft.valueRows[0].id, { descricao: event.target.value })
                                                        }
                                                      }}
                                                      rows={3}
                                                      disabled={busy}
                                                    />
                                                    <div className="flex items-center gap-2">
                                                      <span className="text-sm text-ink-mute">Valor (R$):</span>
                                                      <Input
                                                        className="w-36 text-right"
                                                        value={draft?.valueRows?.[0]?.valorRevisado || draft?.valor || ''}
                                                        onChange={(event) => {
                                                          updateDraft(item.id, { valor: event.target.value })
                                                          if (draft?.valueRows?.[0]) {
                                                            syncValueRow(item.id, draft.valueRows[0].id, { valorRevisado: event.target.value })
                                                          }
                                                        }}
                                                        disabled={busy}
                                                      />
                                                    </div>
                                                  </>
                                                )}
                                                <div className="flex items-center justify-end gap-2">
                                                  <Button size="sm" variant="ghost" onClick={() => setEditorKey(null)} disabled={busy}>
                                                    Cancelar
                                                  </Button>
                                                  <Button
                                                    size="sm"
                                                    className="bg-indigo-600 text-white hover:bg-indigo-700"
                                                    onClick={() => {
                                                      setEditorKey(null)
                                                      void saveAndAdvance(item, mode)
                                                    }}
                                                    disabled={busy}
                                                  >
                                                    Salvar aprovação
                                                  </Button>
                                                </div>
                                              </div>
                                            </td>
                                          </tr>
                                        ) : null}
                                      </tbody>
                                    </Table>
                                  </div>
                                )
                              })}
                            </div>
                          ) : null}
                        </div>
                      )
                    })}
                  </div>
                ) : null}
              </section>
            )
          })}
        </div>
      )}

      <Dialog open={postergarConfirmId !== null} onOpenChange={(open) => !open && setPostergarConfirmId(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Postergar lançamento</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-ink-mute">
            Mover este lançamento para o faturamento do próximo mês?
          </p>
          <p className="text-xs text-ink-mute">
            O item será removido da lista atual e reaparecerá no período seguinte.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPostergarConfirmId(null)}>
              Cancelar
            </Button>
            <Button
              variant="default"
              className="bg-primary hover:bg-primary-deep text-primary-foreground"
              onClick={() => {
                const confirmId = postergarConfirmId
                setPostergarConfirmId(null)
                if (confirmId) {
                  const item = items.find((i) => i.id === confirmId)
                  if (item) void postergarItem(item)
                }
              }}
            >
              Postergar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  )
}
