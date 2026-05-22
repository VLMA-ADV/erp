'use client'

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Clock, Eye, FileText, Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { CommandSelect, type CommandSelectOption } from '@/components/ui/command-select'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Table } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/toast'
import { usePermissions } from '@/lib/hooks/use-permissions'
import NfsePreviewDialog from './nfse-preview-dialog'

interface RevisaoItem {
  id: string
  contratoId: string
  casoId: string
  timesheetId: string | null
  status: string
  origemTipo: string
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

interface ContratoGroup {
  key: string
  nome: string
  numero: number | null
  casos: CasoGroup[]
}

interface ClienteGroup {
  key: string
  nome: string
  contratos: ContratoGroup[]
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
  timesheetAnchorItem: RevisaoItem | null
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
type HistoryStageKey = 'usuario' | 'revisor' | 'aprovador'
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

interface HistoricalDisplayRow {
  rowKey: string
  stageKey: HistoryStageKey
  label: string
  dateText: string
  userName: string
  reviewerName: string
  text: string
  hoursText: string
  value: number
  rowClass: string
  labelClass: string
  showEdit: boolean
  showPostergar: boolean
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

function formatHistoryHours(value: number | null | undefined) {
  return `${Number(value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} h`
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

function hasReviewerHistory(item: RevisaoItem) {
  return (
    item.status === 'em_aprovacao' ||
    item.status === 'aprovado' ||
    !areStageNumbersEqual(item.horasRevisadas, getOriginalItemHours(item)) ||
    !areStageNumbersEqual(item.valorRevisado, getOriginalItemValue(item))
  )
}

function hasApproverHistory(item: RevisaoItem) {
  return (
    (item.horasAprovadas !== null && item.horasAprovadas !== undefined) ||
    (item.valorAprovado !== null && item.valorAprovado !== undefined) ||
    item.status === 'aprovado'
  )
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

function getRuleFilterKey(item: RevisaoItem): RuleFilterKey | null {
  if (item.origemTipo === 'despesa') return 'despesa'
  const kind = getRuleKind(item)
  if (item.origemTipo === 'timesheet' || kind === 'hora' || kind === 'hora_com_cap') return 'hora'
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

  for (const item of items) {
    const clienteKey = item.clienteNome || 'cliente'
    if (!clientes.has(clienteKey)) {
      clientes.set(clienteKey, {
        key: clienteKey,
        nome: item.clienteNome,
        contratos: [],
      })
    }

    const cliente = clientes.get(clienteKey)
    if (!cliente) continue

    const contratoKey = `${item.contratoNumero || 'sem-numero'}-${item.contratoNome}`
    let contrato = cliente.contratos.find((entry) => entry.key === contratoKey)
    if (!contrato) {
      contrato = {
        key: contratoKey,
        nome: item.contratoNome,
        numero: item.contratoNumero,
        casos: [],
      }
      cliente.contratos.push(contrato)
    }

    const casoKey = `${item.casoNumero || 'sem-numero'}-${item.casoNome}`
    let caso = contrato.casos.find((entry) => entry.key === casoKey)
    if (!caso) {
      caso = {
        key: casoKey,
        nome: item.casoNome,
        numero: item.casoNumero,
        itens: [],
      }
      contrato.casos.push(caso)
    }

    caso.itens.push(item)
  }

  return Array.from(clientes.values())
}

function getCaseBaseMetrics(casoGroup: CasoGroup): CaseMetrics {
  const timesheetItems = casoGroup.itens.filter((item) => item.origemTipo === 'timesheet')
  const nonTimesheetItems = casoGroup.itens.filter((item) => item.origemTipo !== 'timesheet')

  return {
    totalHoras: nonTimesheetItems.reduce((acc, item) => acc + getEffectiveItemHours(item), 0) +
      (timesheetItems[0] ? getEffectiveItemHours(timesheetItems[0]) : 0),
    totalValor: nonTimesheetItems.reduce((acc, item) => acc + getEffectiveItemValue(item), 0) +
      (timesheetItems[0] ? getEffectiveItemValue(timesheetItems[0]) : 0),
    itemCount: nonTimesheetItems.length + (timesheetItems[0] ? 1 : 0),
    timesheetAnchorItem: timesheetItems[0] || null,
    nonTimesheetItems,
  }
}

export default function RevisaoDeFaturaList() {
  const { success, error: toastError } = useToast()
  const { hasPermission } = usePermissions()
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
  const [expandedContratos, setExpandedContratos] = useState<Record<string, boolean>>({})
  const [expandedCasos, setExpandedCasos] = useState<Record<string, boolean>>({})
  const [expandedHistorico, setExpandedHistorico] = useState<Record<string, boolean>>({})
  const [editorKey, setEditorKey] = useState<string | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [postergarConfirmId, setPostergarConfirmId] = useState<string | null>(null)
  const [allContratos, setAllContratos] = useState<ContratoOption[]>([])
  const [colaboradores, setColaboradores] = useState<ColaboradorOption[]>([])
  const [approvedItems, setApprovedItems] = useState<RevisaoItem[]>([])
  const [emittingNfse, setEmittingNfse] = useState<string | null>(null)
  const [nfseResult, setNfseResult] = useState<{ ref: string; valor_total: number; focus_response: Record<string, unknown> } | null>(null)
  const [nfsePreview, setNfsePreview] = useState<{ contratoId: string; label: string; itemIds: string[] } | null>(null)

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

  const loadItems = async () => {
    try {
      setLoading(true)
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

  const loadApprovedItems = async () => {
    try {
      const accessToken = await getSessionToken()
      if (!accessToken) return
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-revisao-fatura?status=aprovado`,
        {
          method: 'GET',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        },
      )
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) return
      const parsed: RevisaoItem[] = Array.isArray(payload.data)
        ? payload.data.map(normalizeItem).filter((e: RevisaoItem | null): e is RevisaoItem => e !== null && e.status === 'aprovado')
        : []
      setApprovedItems(parsed)
    } catch (loadError) {
      console.error('loadApprovedItems', loadError)
    }
  }

  const emitNfse = async (contratoId: string, itemIds: string[]) => {
    try {
      setEmittingNfse(contratoId)
      const accessToken = await getSessionToken()
      if (!accessToken) return
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/emit-nfse`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ contrato_id: contratoId, billing_item_ids: itemIds }),
        },
      )
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        toastError(payload.error || 'Erro ao emitir NFS-e')
        return
      }
      setNfseResult({
        ref: String(payload.ref),
        valor_total: Number(payload.valor_total),
        focus_response: (payload.focus_response as Record<string, unknown>) || {},
      })
      success('NFS-e enviada para processamento na Focus NFe!')
      void loadApprovedItems()
    } catch (emitError) {
      console.error('emitNfse', emitError)
      toastError('Erro ao emitir NFS-e')
    } finally {
      setEmittingNfse(null)
    }
  }

  useEffect(() => {
    if (!canRead) return
    void loadItems()
    void loadAllContratos()
    void loadColaboradores()
    void loadApprovedItems()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canRead])

  const visibleItems = useMemo(
    () => (ruleFilter === 'all' ? items : items.filter((item) => getRuleFilterKey(item) === ruleFilter)),
    [items, ruleFilter],
  )

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
    const timesheetAnchor = baseMetrics.timesheetAnchorItem
    const timesheetHours = timesheetAnchor ? getLiveItemHours(timesheetAnchor, 'timesheet') : 0
    const timesheetValue = timesheetAnchor ? getLiveItemValue(timesheetAnchor, 'timesheet') : 0
    const nonTimesheetHours = baseMetrics.nonTimesheetItems.reduce((acc, item) => acc + getLiveItemHours(item, 'default'), 0)
    const nonTimesheetValue = baseMetrics.nonTimesheetItems.reduce((acc, item) => acc + getLiveItemValue(item, 'default'), 0)

    return {
      totalHoras: nonTimesheetHours + (timesheetAnchor ? timesheetHours : 0),
      totalValor: nonTimesheetValue + (timesheetAnchor ? timesheetValue : 0),
      itemCount: baseMetrics.itemCount,
      timesheetAnchorItem: timesheetAnchor,
      nonTimesheetItems: baseMetrics.nonTimesheetItems,
    }
  }, [getLiveItemHours, getLiveItemValue])

  const getReviewRows = useCallback((casoGroup: CasoGroup) => {
    const metrics = getLiveCaseMetrics(casoGroup)
    const rows: Array<{ item: RevisaoItem; mode: ReviewMode; key: string }> = []
    if (metrics.timesheetAnchorItem) {
      rows.push({
        item: metrics.timesheetAnchorItem,
        mode: 'timesheet',
        key: `timesheet:${metrics.timesheetAnchorItem.id}`,
      })
    }
    for (const item of metrics.nonTimesheetItems) {
      rows.push({
        item,
        mode: 'default',
        key: `default:${item.id}`,
      })
    }
    return rows
  }, [getLiveCaseMetrics])

  const allRows = useMemo(() => {
    const rows: Array<{ item: RevisaoItem; mode: ReviewMode; key: string }> = []
    for (const clienteGroup of fullTree) {
      for (const contratoGroup of clienteGroup.contratos) {
        for (const casoGroup of contratoGroup.casos) {
          rows.push(...getReviewRows(casoGroup))
        }
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
        for (const contratoGroup of clienteGroup.contratos) {
          for (const casoGroup of contratoGroup.casos) {
            const metrics = getLiveCaseMetrics(casoGroup)
            acc.horas += metrics.totalHoras
            acc.valor += metrics.totalValor
            acc.itens += metrics.itemCount
          }
        }
        return acc
      },
      { horas: 0, valor: 0, itens: 0 },
    )
  }, [tree, getLiveCaseMetrics])

  const getHistoricalRows = useCallback((item: RevisaoItem, mode: ReviewMode, expanded: boolean) => {
    if (item.historico.length > 0) {
      const usuario = item.historico.find((entry) => entry.role === 'USUARIO') ?? item.historico[0]
      const revisores = item.historico.filter((entry) => entry.role === 'REVISOR')
      const aprovadores = item.historico.filter((entry) => entry.role === 'APROVADOR')
      const aprovador = aprovadores[aprovadores.length - 1] ?? null

      const itemPassedReview =
        item.status === 'em_aprovacao' ||
        item.status === 'aprovado' ||
        aprovadores.length > 0
      if (revisores.length === 0 && itemPassedReview) {
        const syntheticRevisor: RevisaoHistoricoEntry = {
          id: `${item.id}:synthetic-revisor`,
          billingItemId: item.id,
          role: 'REVISOR',
          authorId: '',
          authorName: item.responsavelRevisaoNome || '-',
          horas: item.horasRevisadas ?? getOriginalItemHours(item),
          valor: item.valorRevisado ?? getOriginalItemValue(item),
          texto: null,
          tenantId: '',
          createdAt: item.dataRevisao || usuario.createdAt,
        }
        revisores.push(syntheticRevisor)
      }
      const visibleRevisores = expanded ? revisores : revisores.slice(-1)

      const toDisplayRow = (entry: RevisaoHistoricoEntry, index: number): HistoricalDisplayRow => {
        const stageKey = entry.role.toLowerCase() as HistoryStageKey
        const isUsuario = entry.role === 'USUARIO'
        const isRevisor = entry.role === 'REVISOR'

        return {
          rowKey: `${entry.id}:${index}`,
          stageKey,
          label: entry.role,
          dateText: formatDateTime(entry.createdAt),
          userName: entry.authorName,
          reviewerName: isUsuario ? '-' : entry.authorName,
          text: entry.texto || (mode === 'timesheet' ? item.timesheetDescricao || 'Sem descrição' : getRuleTitle(item)),
          hoursText: formatHistoryHours(entry.horas),
          value: entry.valor,
          rowClass: isUsuario ? 'bg-white' : isRevisor ? 'bg-emerald-50/50' : 'bg-indigo-50/50',
          labelClass: isUsuario
            ? 'rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-700'
            : isRevisor
              ? 'rounded-full bg-emerald-100 px-2 py-1 text-xs text-emerald-700'
              : 'rounded-full bg-indigo-100 px-2 py-1 text-xs text-indigo-700',
          showEdit: false,
          showPostergar: false,
        }
      }

      const rows = [usuario, ...visibleRevisores, ...(aprovador ? [aprovador] : [])].map(toDisplayRow)
      return {
        rows,
        hiddenReviewerCount: Math.max(0, revisores.length - 1),
      }
    }

    const draft = drafts[item.id]
    const originalDate = item.timesheetDataLancamento || item.dataReferencia
    const originalUser = item.timesheetProfissional || item.responsavelFluxoNome || '-'
    const reviewedUser =
      mode === 'timesheet'
        ? draft?.timesheetRows?.[0]?.profissional || item.timesheetProfissional || item.responsavelFluxoNome || '-'
        : draft?.profissional || item.timesheetProfissional || item.responsavelFluxoNome || '-'
    const originalText = mode === 'timesheet' ? item.timesheetDescricao || 'Sem descrição' : getRuleTitle(item)
    const reviewedText =
      mode === 'timesheet'
        ? draft?.timesheetRows?.[0]?.atividade || item.timesheetDescricao || 'Sem descrição'
        : draft?.valueRows?.[0]?.descricao || getRuleTitle(item)

    const rows: HistoricalDisplayRow[] = [
      {
        rowKey: 'usuario:fallback',
        stageKey: 'usuario',
        label: 'USUARIO',
        dateText: formatDate(originalDate),
        userName: originalUser,
        reviewerName: item.responsavelRevisaoNome || '-',
        text: originalText,
        hoursText: formatHistoryHours(getOriginalItemHours(item)),
        value: getOriginalItemValue(item),
        rowClass: 'bg-white',
        labelClass: 'rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-700',
        showEdit: true,
        showPostergar: Boolean(item.timesheetId),
      },
    ]

    if (hasReviewerHistory(item)) {
      rows.push({
        rowKey: 'revisor:fallback',
        stageKey: 'revisor',
        label: 'REVISOR',
        dateText: formatDate(item.dataRevisao || item.dataReferencia || item.timesheetDataLancamento),
        userName: reviewedUser,
        reviewerName: item.responsavelRevisaoNome || '-',
        text: reviewedText,
        hoursText: formatHistoryHours(item.horasRevisadas ?? getOriginalItemHours(item)),
        value: item.valorRevisado ?? getOriginalItemValue(item),
        rowClass: 'bg-emerald-50/50',
        labelClass: 'rounded-full bg-emerald-100 px-2 py-1 text-xs text-emerald-700',
        showEdit: true,
        showPostergar: false,
      })
    }

    if (hasApproverHistory(item)) {
      rows.push({
        rowKey: 'aprovador:fallback',
        stageKey: 'aprovador',
        label: 'APROVADOR',
        dateText: formatDate(item.dataAprovacao || item.dataRevisao || item.dataReferencia || item.timesheetDataLancamento),
        userName: reviewedUser,
        reviewerName: item.responsavelAprovacaoNome || item.responsavelRevisaoNome || '-',
        text: reviewedText,
        hoursText: formatHistoryHours(item.horasAprovadas ?? item.horasRevisadas ?? getOriginalItemHours(item)),
        value: item.valorAprovado ?? item.valorRevisado ?? getOriginalItemValue(item),
        rowClass: 'bg-indigo-50/50',
        labelClass: 'rounded-full bg-indigo-100 px-2 py-1 text-xs text-indigo-700',
        showEdit: false,
        showPostergar: false,
      })
    }

    return { rows, hiddenReviewerCount: 0 }
  }, [drafts])

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
      await loadItems()
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
      await loadItems()
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
      <div className="rounded-md bg-red-50 p-4">
        <p className="text-sm text-red-800">Você não tem permissão para visualizar a revisão de faturamento.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {error ? (
        <Alert className="border-red-200 bg-red-50 text-red-700">
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
                ? 'border-slate-900 bg-slate-900 text-white'
                : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300'
            }`}
          >
            <span>{button.label}</span>
            <span className={`rounded-full px-2 py-0.5 text-xs ${ruleFilter === button.key ? 'bg-white/20 text-white' : 'bg-white text-slate-600'}`}>
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
          <span>
            Horas: <strong className="text-foreground">{formatHours(totals.horas)}</strong>
          </span>
        </div>
        <div className="font-semibold font-tabular">{formatMoney(totals.valor)}</div>
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
            const clienteExpanded = expandedClientes[clienteGroup.key] !== false
            const clienteTotals = clienteGroup.contratos.reduce(
              (acc, contratoGroup) => {
                for (const casoGroup of contratoGroup.casos) {
                  const metrics = getLiveCaseMetrics(casoGroup)
                  acc.horas += metrics.totalHoras
                  acc.valor += metrics.totalValor
                  acc.itens += metrics.itemCount
                }
                return acc
              },
              { horas: 0, valor: 0, itens: 0 },
            )

            return (
              <section key={clienteGroup.key} className="overflow-hidden rounded-2xl border bg-white shadow-sm">
                <div className="border-b bg-slate-50 px-4 py-3">
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-3 text-left"
                    onClick={() => setExpandedClientes((prev) => ({ ...prev, [clienteGroup.key]: !clienteExpanded }))}
                  >
                    <div className="flex items-center gap-2">
                      {clienteExpanded ? <ChevronDown className="h-4 w-4 text-slate-500" /> : <ChevronRight className="h-4 w-4 text-slate-500" />}
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{clienteGroup.nome}</p>
                        <p className="text-xs text-slate-500">
                          {clienteTotals.itens} item(ns) | {formatHours(clienteTotals.horas)} h
                        </p>
                      </div>
                    </div>
                    <p className="text-sm font-semibold text-slate-900 font-tabular">{formatMoney(clienteTotals.valor)}</p>
                  </button>
                </div>

                {clienteExpanded ? (
                  <div className="space-y-4 p-4">
                    {clienteGroup.contratos.map((contratoGroup) => {
                      const contratoExpanded = expandedContratos[contratoGroup.key] !== false
                      const contratoTotals = contratoGroup.casos.reduce(
                        (acc, casoGroup) => {
                          const metrics = getLiveCaseMetrics(casoGroup)
                          acc.horas += metrics.totalHoras
                          acc.valor += metrics.totalValor
                          acc.itens += metrics.itemCount
                          return acc
                        },
                        { horas: 0, valor: 0, itens: 0 },
                      )
                      const contractRows = contratoGroup.casos.flatMap((casoGroup) => getReviewRows(casoGroup))
                      const contractRowIds = contractRows.filter((row) => canAdvance(row.item.status)).map((row) => row.item.id)
                      const allSelected = contractRowIds.length > 0 && contractRowIds.every((id) => selectedItemIds.includes(id))
                      const selectedCount = contractRowIds.filter((id) => selectedItemIds.includes(id)).length

                      return (
                        <div key={`${clienteGroup.key}-${contratoGroup.key}`} className="rounded-xl border border-slate-200">
                          <div className="border-b bg-white px-4 py-3">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <button
                                type="button"
                                className="flex items-center gap-2 text-left"
                                onClick={() => setExpandedContratos((prev) => ({ ...prev, [contratoGroup.key]: !contratoExpanded }))}
                              >
                                {contratoExpanded ? <ChevronDown className="h-4 w-4 text-slate-500" /> : <ChevronRight className="h-4 w-4 text-slate-500" />}
                                <div>
                                  <p className="text-sm font-semibold text-slate-900">
                                    {contratoGroup.numero ? `${contratoGroup.numero} - ` : ''}
                                    {contratoGroup.nome}
                                  </p>
                                  <p className="text-xs text-slate-500">
                                    {contratoTotals.itens} item(ns) | {formatHours(contratoTotals.horas)} h
                                  </p>
                                </div>
                              </button>

                              <div className="flex flex-wrap items-center gap-3">
                                <label className="flex items-center gap-2 text-xs text-slate-600">
                                  <input
                                    type="checkbox"
                                    className="h-4 w-4 rounded border-slate-300"
                                    checked={allSelected}
                                    onChange={(event) => {
                                      const checked = event.target.checked
                                      setSelectedItemIds((prev) =>
                                        checked
                                          ? Array.from(new Set([...prev, ...contractRowIds]))
                                          : prev.filter((id) => !contractRowIds.includes(id)),
                                      )
                                    }}
                                  />
                                  Selecionar todos
                                </label>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => void approveSelected(`batch:${contratoGroup.key}`, contractRowIds.filter((id) => selectedItemIds.includes(id)))}
                                  disabled={selectedCount === 0 || busyKey === `batch:${contratoGroup.key}`}
                                >
                                  {busyKey === `batch:${contratoGroup.key}` ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                  Aprovar selecionados
                                </Button>
                                <p className="text-sm font-semibold text-slate-900 font-tabular">{formatMoney(contratoTotals.valor)}</p>
                              </div>
                            </div>
                          </div>

                          {contratoExpanded ? (
                            <div className="space-y-4 p-4">
                              {contratoGroup.casos.map((casoGroup) => {
                                const casoExpanded = expandedCasos[casoGroup.key] !== false
                                const caseMetrics = getLiveCaseMetrics(casoGroup)
                                const reviewRows = getReviewRows(casoGroup)

                                return (
                                  <div key={`${contratoGroup.key}-${casoGroup.key}`} className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60">
                                    <div className="border-b border-slate-200 px-4 py-3">
                                      <button
                                        type="button"
                                        className="flex w-full items-center justify-between gap-3 text-left"
                                        onClick={() => setExpandedCasos((prev) => ({ ...prev, [casoGroup.key]: !casoExpanded }))}
                                      >
                                        <div className="flex items-center gap-2">
                                          {casoExpanded ? <ChevronDown className="h-4 w-4 text-slate-500" /> : <ChevronRight className="h-4 w-4 text-slate-500" />}
                                          <div>
                                            <p className="text-sm font-semibold text-slate-800">
                                              {casoGroup.numero ? `${casoGroup.numero} - ` : ''}
                                              {casoGroup.nome}
                                            </p>
                                            <p className="text-xs text-slate-500">
                                              {caseMetrics.itemCount} item(ns) | {formatHours(caseMetrics.totalHoras)} h
                                            </p>
                                          </div>
                                        </div>
                                        <p className="text-sm font-semibold text-slate-900 font-tabular">{formatMoney(caseMetrics.totalValor)}</p>
                                      </button>
                                    </div>

                                    {casoExpanded ? (
                                      <div className="px-3 py-3">
                                        <Table className="min-w-[1120px]">
                                          <thead className="bg-white">
                                            <tr className="border-b text-[11px] uppercase tracking-wide text-slate-500">
                                              <th className="w-10 px-3 py-2 text-left" />
                                              <th className="px-3 py-2 text-left">Role</th>
                                              <th className="px-3 py-2 text-left">Data/hora</th>
                                              <th className="px-3 py-2 text-left">Autor</th>
                                              <th className="px-3 py-2 text-left">Responsavel</th>
                                              <th className="px-3 py-2 text-left">Texto</th>
                                              <th className="px-3 py-2 text-right">Horas</th>
                                              <th className="px-3 py-2 text-right">Valor</th>
                                              <th className="px-3 py-2 text-right">Acoes</th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {reviewRows.map(({ item, mode, key }) => {
                                              const draft = drafts[item.id]
                                              const busy = busyKey === key || busyKey === `advance:${item.id}` || busyKey === `batch:${contratoGroup.key}`
                                              const historyExpanded = expandedHistorico[key] === true
                                              const {
                                                rows: historicalRows,
                                                hiddenReviewerCount,
                                              } = getHistoricalRows(item, mode, historyExpanded)
                                              const reviewerToggleVisible = hiddenReviewerCount > 0

                                              return (
                                                <Fragment key={key}>
                                                  {historicalRows.map((historyRow, historyIndex) => (
                                                    <Fragment key={`${key}:${historyRow.rowKey}`}>
                                                      <tr className={`border-b align-top ${historyRow.rowClass}`}>
                                                        {historyIndex === 0 ? (
                                                          <td rowSpan={historicalRows.length + (reviewerToggleVisible ? 1 : 0)} className="px-3 py-3">
                                                            <input
                                                              type="checkbox"
                                                              className="mt-1 h-4 w-4 rounded border-slate-300"
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
                                                          </td>
                                                        ) : null}
                                                        <td className="px-3 py-3 text-sm font-semibold">
                                                          <span className={historyRow.labelClass}>{historyRow.label}</span>
                                                        </td>
                                                        <td className="px-3 py-3 text-sm text-slate-700">{historyRow.dateText}</td>
                                                        <td className="px-3 py-3 text-sm text-slate-700">{historyRow.userName}</td>
                                                        <td className="px-3 py-3 text-sm text-slate-700">{historyRow.reviewerName}</td>
                                                        <td className="px-3 py-3 text-sm text-slate-700">
                                                          <div className="max-w-[340px] whitespace-normal break-words">{historyRow.text}</div>
                                                        </td>
                                                        <td className="px-3 py-3 text-right text-sm text-slate-700 font-tabular">{historyRow.hoursText}</td>
                                                        <td className="px-3 py-3 text-right text-sm font-medium text-slate-900 font-tabular">{formatMoney(historyRow.value)}</td>
                                                        <td className="px-3 py-3">
                                                          <div className="flex items-center justify-end gap-2">
                                                            {(() => {
                                                              const isActorRow =
                                                                (item.status === 'em_revisao' && historyRow.stageKey === 'usuario') ||
                                                                (item.status === 'em_aprovacao' && historyRow.stageKey === 'revisor')
                                                              if (!isActorRow) return null
                                                              return (
                                                                <>
                                                                  <Button
                                                                    size="sm"
                                                                    variant="outline"
                                                                    onClick={() => void saveAndAdvance(item, mode)}
                                                                    disabled={!canAdvance(item.status) || busy}
                                                                  >
                                                                    {busy && busyKey !== `postergar:${item.id}` ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                                                    OK
                                                                  </Button>
                                                                  <Button
                                                                    size="sm"
                                                                    variant="ghost"
                                                                    onClick={() => setEditorKey((current) => (current === key ? null : key))}
                                                                    disabled={busy}
                                                                  >
                                                                    Editar
                                                                  </Button>
                                                                </>
                                                              )
                                                            })()}
                                                            {historyRow.showPostergar ? (
                                                              <Button
                                                                size="sm"
                                                                variant="ghost"
                                                                className="text-amber-600 hover:text-amber-700 hover:bg-amber-50"
                                                                onClick={() => setPostergarConfirmId(item.id)}
                                                                disabled={busy}
                                                                title="Postergar para próximo mês"
                                                              >
                                                                {busyKey === `postergar:${item.id}` ? (
                                                                  <Loader2 className="h-4 w-4 animate-spin" />
                                                                ) : (
                                                                  <Clock className="h-4 w-4" />
                                                                )}
                                                              </Button>
                                                            ) : null}
                                                          </div>
                                                        </td>
                                                      </tr>
                                                      {historyIndex === 0 && reviewerToggleVisible ? (
                                                        <tr className="border-b bg-slate-50">
                                                          <td colSpan={8} className="px-3 py-2">
                                                            <Button
                                                              size="sm"
                                                              variant="ghost"
                                                              onClick={() =>
                                                                setExpandedHistorico((prev) => ({
                                                                  ...prev,
                                                                  [key]: !historyExpanded,
                                                                }))
                                                              }
                                                            >
                                                              {historyExpanded
                                                                ? 'Ocultar edições anteriores'
                                                                : `Ver ${hiddenReviewerCount} edição${hiddenReviewerCount > 1 ? 'es' : ''} anterior${hiddenReviewerCount > 1 ? 'es' : ''}`}
                                                            </Button>
                                                          </td>
                                                        </tr>
                                                      ) : null}
                                                    </Fragment>
                                                  ))}

                                                  {editorKey === key ? (
                                                    <tr className="border-b bg-slate-50/60">
                                                      <td colSpan={9} className="px-4 py-4">
                                                        <div className="space-y-4 rounded-xl border bg-white p-4">
                                                          <div className="flex flex-wrap items-center justify-between gap-3">
                                                            <div>
                                                              <p className="text-sm font-semibold text-slate-900">Historico do lancamento</p>
                                                              <p className="text-xs text-slate-500">
                                                                O bloco do usuario permanece read-only; a edicao abaixo alimenta a linha de revisor ou aprovador.
                                                              </p>
                                                            </div>
                                                            <Button
                                                              onClick={() =>
                                                                void (async () => {
                                                                  const saved = await saveReviewItem(item, mode)
                                                                  if (saved) setEditorKey(null)
                                                                })()
                                                              }
                                                              disabled={busy}
                                                            >
                                                              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                                              Confirmar edicao
                                                            </Button>
                                                          </div>

                                                          <div className="grid gap-3 lg:grid-cols-2">
                                                            <div className="space-y-3 rounded-xl bg-slate-50 p-3">
                                                              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Usuario</p>
                                                              <div className="grid gap-3 md:grid-cols-2">
                                                                <div>
                                                                  <p className="text-xs text-slate-500">Caso</p>
                                                                  <p className="text-sm text-slate-800">{caseLabelById.get(item.casoId) || casoGroup.nome}</p>
                                                                </div>
                                                                <div>
                                                                  <p className="text-xs text-slate-500">Profissional</p>
                                                                  <p className="text-sm text-slate-800">{item.timesheetProfissional || item.responsavelFluxoNome || '-'}</p>
                                                                </div>
                                                                <div className="md:col-span-2">
                                                                  <p className="text-xs text-slate-500">Texto</p>
                                                                  <p className="text-sm text-slate-800">{mode === 'timesheet' ? item.timesheetDescricao || '-' : getRuleTitle(item)}</p>
                                                                </div>
                                                                <div>
                                                                  <p className="text-xs text-slate-500">Minutos</p>
                                                                  <p className="text-sm text-slate-800">{hoursToMinutes(getOriginalItemHours(item))}</p>
                                                                </div>
                                                                <div>
                                                                  <p className="text-xs text-slate-500">Valor</p>
                                                                  <p className="text-sm text-slate-800 font-tabular">{formatMoney(getOriginalItemValue(item))}</p>
                                                                </div>
                                                              </div>
                                                            </div>

                                                            <div className="space-y-3 rounded-xl border border-slate-200 p-3">
                                                              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                                                {item.status === 'em_aprovacao' ? 'Aprovador' : 'Revisor'}
                                                              </p>
                                                              <div className="grid gap-3 md:grid-cols-2">
                                                                <div className="md:col-span-2">
                                                                  <label className="mb-1 block text-xs text-slate-500">Caso</label>
                                                                  <CommandSelect
                                                                    value={draft?.casoId || item.casoId}
                                                                    onValueChange={(value) => updateDraft(item.id, { casoId: value })}
                                                                    options={caseOptions}
                                                                    placeholder="Selecione o caso"
                                                                    searchPlaceholder="Buscar caso ou contrato..."
                                                                    emptyText="Nenhum caso encontrado."
                                                                    disabled={busy}
                                                                  />
                                                                </div>

                                                                {mode === 'timesheet' ? (
                                                                  <div className="md:col-span-2 space-y-3">
                                                                    {draft?.timesheetRows.map((row) => {
                                                                      const revisedMinutes = hoursToMinutes(parseDecimalInput(row.horasRevisadas || row.horasIniciais))
                                                                      const revisedValue =
                                                                        parseDecimalInput(row.horasRevisadas || row.horasIniciais) * parseDecimalInput(row.valorHora)
                                                                      const rowProfissionalOptions = row.profissional && !colaboradorOptions.some((option) => option.value === row.profissional)
                                                                        ? [{ value: row.profissional, label: row.profissional }, ...colaboradorOptions]
                                                                        : colaboradorOptions
                                                                      return (
                                                                        <div key={row.id} className="rounded-lg border p-3">
                                                                          <div className="grid gap-3 md:grid-cols-2">
                                                                            <div>
                                                                              <label className="mb-1 block text-xs text-slate-500">Profissional</label>
                                                                              <CommandSelect
                                                                                value={row.profissional}
                                                                                onValueChange={(value) => syncTimesheetRow(item.id, row.id, { profissional: value })}
                                                                                options={rowProfissionalOptions}
                                                                                placeholder="Selecione o profissional"
                                                                                searchPlaceholder="Buscar colaborador..."
                                                                                emptyText="Nenhum colaborador encontrado."
                                                                                disabled={busy}
                                                                              />
                                                                            </div>
                                                                            <div>
                                                                              <label className="mb-1 block text-xs text-slate-500">Duração</label>
                                                                              {(() => {
                                                                                const split = splitMinutosTotal(revisedMinutes)
                                                                                const syncHHMM = (h: string, m: string) => {
                                                                                  const totalMin = computeMinutosFromHHMM(h, m)
                                                                                  syncTimesheetRow(item.id, row.id, { horasRevisadas: minutesToHoursString(String(totalMin)) })
                                                                                }
                                                                                return (
                                                                                  <div className="flex items-center gap-2">
                                                                                    <Input
                                                                                      value={split.horas}
                                                                                      onChange={(event) => syncHHMM(sanitizeMinutesInput(event.target.value), split.minutos)}
                                                                                      inputMode="numeric"
                                                                                      placeholder="h"
                                                                                      disabled={busy}
                                                                                      className="w-16 text-center"
                                                                                      aria-label="Horas"
                                                                                    />
                                                                                    <span className="text-xs text-slate-500">h</span>
                                                                                    <Input
                                                                                      value={split.minutos}
                                                                                      onChange={(event) => syncHHMM(split.horas, sanitizeMinutesInput(event.target.value))}
                                                                                      inputMode="numeric"
                                                                                      placeholder="min"
                                                                                      disabled={busy}
                                                                                      className="w-16 text-center"
                                                                                      aria-label="Minutos"
                                                                                    />
                                                                                    <span className="text-xs text-slate-500">min</span>
                                                                                  </div>
                                                                                )
                                                                              })()}
                                                                            </div>
                                                                            <div className="md:col-span-2">
                                                                              <label className="mb-1 block text-xs text-slate-500">Texto</label>
                                                                              <Textarea
                                                                                value={row.atividade}
                                                                                onChange={(event) => syncTimesheetRow(item.id, row.id, { atividade: event.target.value })}
                                                                                rows={2}
                                                                                disabled={busy}
                                                                              />
                                                                            </div>
                                                                            <div>
                                                                              <p className="text-xs text-slate-500">Valor recalculado</p>
                                                                              <p className="mt-2 text-sm font-medium text-slate-900 font-tabular">{formatMoney(revisedValue)}</p>
                                                                            </div>
                                                                          </div>
                                                                        </div>
                                                                      )
                                                                    })}
                                                                  </div>
                                                                ) : (
                                                                  <>
                                                                    {(() => {
                                                                      const currentProfissional = draft?.profissional || ''
                                                                      const profissionalSelectOptions = currentProfissional && !colaboradorOptions.some((option) => option.value === currentProfissional)
                                                                        ? [{ value: currentProfissional, label: currentProfissional }, ...colaboradorOptions]
                                                                        : colaboradorOptions
                                                                      return (
                                                                        <div>
                                                                          <label className="mb-1 block text-xs text-slate-500">Profissional</label>
                                                                          <CommandSelect
                                                                            value={currentProfissional}
                                                                            onValueChange={(value) => updateDraft(item.id, { profissional: value })}
                                                                            options={profissionalSelectOptions}
                                                                            placeholder="Selecione o profissional"
                                                                            searchPlaceholder="Buscar colaborador..."
                                                                            emptyText="Nenhum colaborador encontrado."
                                                                            disabled={busy}
                                                                          />
                                                                        </div>
                                                                      )
                                                                    })()}
                                                                    <div>
                                                                      <label className="mb-1 block text-xs text-slate-500">Minutos</label>
                                                                      <Input
                                                                        value={String(hoursToMinutes(parseDecimalInput(draft?.horas || '0')))}
                                                                        onChange={(event) => {
                                                                          const nextHours = minutesToHoursString(event.target.value)
                                                                          const currentRate =
                                                                            getEffectiveItemHours(item) > 0
                                                                              ? getEffectiveItemValue(item) / getEffectiveItemHours(item)
                                                                              : item.timesheetValorHora || 0
                                                                          const nextValue =
                                                                            getRuleFilterKey(item) === 'hora' && currentRate > 0
                                                                              ? String(parseDecimalInput(nextHours) * currentRate)
                                                                              : draft?.valor || '0'
                                                                          updateDraft(item.id, { horas: nextHours, valor: nextValue })
                                                                          if (draft?.valueRows?.[0]) {
                                                                            syncValueRow(item.id, draft.valueRows[0].id, { valorRevisado: nextValue })
                                                                          }
                                                                        }}
                                                                        inputMode="numeric"
                                                                        disabled={busy}
                                                                      />
                                                                    </div>
                                                                    <div className="md:col-span-2">
                                                                      <label className="mb-1 block text-xs text-slate-500">Texto</label>
                                                                      <Textarea
                                                                        value={draft?.valueRows?.[0]?.descricao || ''}
                                                                        onChange={(event) => {
                                                                          if (draft?.valueRows?.[0]) {
                                                                            syncValueRow(item.id, draft.valueRows[0].id, { descricao: event.target.value })
                                                                          }
                                                                        }}
                                                                        rows={2}
                                                                        disabled={busy}
                                                                      />
                                                                    </div>
                                                                    <div>
                                                                      <p className="text-xs text-slate-500">Valor revisado</p>
                                                                      <p className="mt-2 text-sm font-medium text-slate-900 font-tabular">{formatMoney(getLiveItemValue(item, 'default'))}</p>
                                                                    </div>
                                                                  </>
                                                                )}
                                                              </div>
                                                            </div>
                                                          </div>
                                                        </div>
                                                      </td>
                                                    </tr>
                                                  ) : null}
                                                </Fragment>
                                              )
                                            })}
                                          </tbody>
                                        </Table>
                                      </div>
                                    ) : null}
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
          <p className="text-sm text-slate-600">
            Mover este lançamento para o faturamento do próximo mês?
          </p>
          <p className="text-xs text-slate-400">
            O item será removido da lista atual e reaparecerá no período seguinte.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPostergarConfirmId(null)}>
              Cancelar
            </Button>
            <Button
              variant="default"
              className="bg-amber-600 hover:bg-amber-700 text-white"
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

      {/* Seção: Prontos para emissão de NFS-e */}
      {approvedItems.length > 0 && (() => {
        const byContrato = approvedItems.reduce<Record<string, { nome: string; numero: number | null; items: RevisaoItem[] }>>((acc, item) => {
          const key = item.contratoId
          if (!acc[key]) acc[key] = { nome: item.contratoNome, numero: item.contratoNumero, items: [] }
          acc[key].items.push(item)
          return acc
        }, {})

        return (
          <div className="mt-8 rounded-xl border border-green-200 bg-green-50/60 p-4">
            <div className="mb-4 flex items-center gap-2">
              <FileText className="h-5 w-5 text-green-700" />
              <h3 className="text-sm font-semibold text-green-800">Prontos para emissão de NFS-e</h3>
              <span className="rounded-full bg-green-200 px-2 py-0.5 text-xs font-medium text-green-800">
                {approvedItems.length} item(ns) aprovados
              </span>
            </div>

            <div className="space-y-3">
              {Object.entries(byContrato).map(([contratoId, group]) => {
                const valorTotal = group.items.reduce((sum, item) => {
                  const v = item.valorAprovado ?? item.valorRevisado ?? item.valorInformado ?? 0
                  return sum + Number(v)
                }, 0)
                const isBusy = emittingNfse === contratoId

                return (
                  <div key={contratoId} className="flex items-center justify-between rounded-lg border border-green-200 bg-white px-4 py-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">
                        {group.numero ? `${group.numero} — ` : ''}{group.nome}
                      </p>
                      <p className="text-xs text-slate-500 font-tabular">
                        {group.items.length} item(ns) · {valorTotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-blue-300 text-blue-700 hover:bg-blue-50"
                        onClick={() => setNfsePreview({
                          contratoId,
                          label: `${group.numero ? `${group.numero} — ` : ''}${group.nome}`,
                          itemIds: group.items.map((i) => i.id),
                        })}
                      >
                        <Eye className="mr-2 h-4 w-4" /> Visualizar prévia
                      </Button>
                      <Button
                        size="sm"
                        className="bg-green-700 hover:bg-green-800 text-white"
                        disabled={isBusy}
                        onClick={() => void emitNfse(contratoId, group.items.map((i) => i.id))}
                      >
                        {isBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4" />}
                        Emitir NFS-e
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })()}

      {/* Dialog: prévia rascunho NFS-e (camada anterior pedida pelo Filipe) */}
      <NfsePreviewDialog
        open={nfsePreview !== null}
        contratoId={nfsePreview?.contratoId ?? null}
        contratoLabel={nfsePreview?.label}
        onClose={() => setNfsePreview(null)}
        onConfirmEmit={() => {
          if (!nfsePreview) return
          const { contratoId, itemIds } = nfsePreview
          setNfsePreview(null)
          void emitNfse(contratoId, itemIds)
        }}
      />

      {/* Dialog: resultado da emissão Focus NFe */}
      <Dialog open={nfseResult !== null} onOpenChange={(open) => { if (!open) setNfseResult(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-green-700">
              <FileText className="h-5 w-5" />
              NFS-e enviada para processamento
            </DialogTitle>
          </DialogHeader>
          {nfseResult && (
            <div className="space-y-3 text-sm">
              <div className="rounded-lg bg-green-50 p-3">
                <p className="font-medium text-green-800">Status: Pendente (aguardando prefeitura)</p>
                <p className="mt-1 text-green-700">Referência: <span className="font-mono">{nfseResult.ref}</span></p>
                <p className="text-green-700 font-tabular">Valor: {nfseResult.valor_total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p>
              </div>
              <p className="text-xs text-slate-500">
                A nota foi enviada à Focus NFe em modo homologação. Consulte o painel da Focus NFe para acompanhar o status.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setNfseResult(null)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
