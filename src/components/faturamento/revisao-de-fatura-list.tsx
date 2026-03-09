'use client'

import { Fragment, useEffect, useMemo, useState } from 'react'
import { Check, ChevronDown, ChevronRight, Eye, Loader2, Plus, Save, Settings2, SquarePen, Trash2, Undo2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { CommandSelect, type CommandSelectOption } from '@/components/ui/command-select'
import { Input } from '@/components/ui/input'
import { MoneyInput } from '@/components/ui/money-input'
import { NativeSelect } from '@/components/ui/native-select'
import { Table } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip } from '@/components/ui/tooltip'
import { useToast } from '@/components/ui/toast'
import { usePermissions } from '@/lib/hooks/use-permissions'

interface RevisaoItem {
  id: string
  contratoId: string
  casoId: string
  timesheetId: string | null
  batchId: string | null
  batchNumero: number | null
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
  responsavelRevisaoNome: string | null
  responsavelAprovacaoNome: string | null
  timesheetDataLancamento: string
  timesheetHoras: number
  timesheetDescricao: string
  timesheetProfissional: string
  timesheetValorHora: number
  snapshot: Record<string, unknown>
}

interface CasoGroup {
  key: string
  nome: string
  numero: number | null
  totalHoras: number
  totalValor: number
  itens: RevisaoItem[]
}

interface ContratoGroup {
  key: string
  contratoId: string
  nome: string
  numero: number | null
  totalHoras: number
  totalValor: number
  casos: CasoGroup[]
}

interface ClienteGroup {
  key: string
  nome: string
  totalHoras: number
  totalValor: number
  contratos: ContratoGroup[]
}

interface DraftFields {
  horas: string
  valor: string
  observacao: string
  timesheetRows: TimesheetRowDraft[]
  valueRows: ValueRowDraft[]
}

interface FluxoResponsavel {
  colaborador_id: string
  ordem: number
}

interface CasoTimesheetConfig {
  id: string
  numero: number | null
  nome: string
  timesheetConfig: {
    revisores: FluxoResponsavel[]
    aprovadores: FluxoResponsavel[]
  }
}

interface ContratoTimesheetConfig {
  id: string
  numero: number | null
  nome: string
  casos: CasoTimesheetConfig[]
}

interface TimesheetRowDraft {
  id: string
  casoId: string
  contratoId: string
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

interface CaseDisplayMetrics {
  totalHoras: number
  totalValor: number
  itemCount: number
  timesheetHours: number
  timesheetValue: number
  timesheetItemCount: number
  timesheetAnchorItem: RevisaoItem | null
  nonTimesheetItems: RevisaoItem[]
}

interface ClienteReviewItemTab {
  key: string
  label: string
  itemId: string
  mode: 'default' | 'timesheet'
}

interface ClienteReviewContractTab {
  key: string
  label: string
  items: ClienteReviewItemTab[]
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

function resolveNumber(primary: number | null | undefined, fallback?: number | null | undefined) {
  return primary ?? fallback ?? 0
}

function getEffectiveItemHours(item: RevisaoItem) {
  return item.horasAprovadas ?? item.horasRevisadas ?? item.horasInformadas ?? 0
}

function getEffectiveItemValue(item: RevisaoItem) {
  return item.valorAprovado ?? item.valorRevisado ?? item.valorInformado ?? 0
}

function parseDecimalInput(value: string) {
  const normalized = value.replace(',', '.').trim()
  if (!normalized) return 0
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : 0
}

function formatMoney(value: number | null | undefined) {
  const amount = Number(value || 0)
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(amount)
}

function formatHours(value: number | null | undefined) {
  const amount = Number(value || 0)
  return amount.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatStatus(status: string) {
  switch (status) {
    case 'em_revisao':
      return 'Em revisão'
    case 'em_aprovacao':
      return 'Em aprovação'
    case 'aprovado':
      return 'Aprovado'
    case 'faturado':
      return 'Faturado'
    case 'cancelado':
      return 'Cancelado'
    default:
      return status || '-'
  }
}

function formatDate(value: string) {
  if (!value) return '-'
  const [year, month, day] = value.split('-')
  if (!year || !month || !day) return value
  return `${day}/${month}/${year}`
}

function normalizeDateInput(value: string) {
  if (!value) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString().slice(0, 10)
}

function formatDateDisplay(value: string) {
  if (!value) return ''
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(value)) return value
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-')
    return `${day}/${month}/${year}`
  }
  return value
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

function createDraftRowId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function toObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function parseSnapshotTimesheetRows(item: RevisaoItem): TimesheetRowDraft[] {
  const snapshotRows = Array.isArray(item.snapshot?.timesheet_itens_revisao)
    ? (item.snapshot.timesheet_itens_revisao as unknown[])
    : []

  if (snapshotRows.length > 0) {
    const parsed = snapshotRows
      .map((entry) => {
        const row = toObject(entry)
        if (!row) return null
        const horasIniciais = asNumber(row.horas_iniciais ?? row.horas_informadas ?? row.horas)
        const horasRevisadas = asNumber(row.horas_revisadas ?? row.horas)
        return {
          id: asString(row.id) || createDraftRowId(),
          casoId: asString(row.caso_id) || item.casoId,
          contratoId: asString(row.contrato_id) || item.contratoId,
          dataLancamento: normalizeDateInput(asString(row.data_lancamento)),
          profissional: asString(row.profissional),
          atividade: asString(row.atividade ?? row.descricao),
          horasIniciais: String(horasIniciais),
          horasRevisadas: String(horasRevisadas || horasIniciais),
          valorHoraInicial: String(asNumber(row.valor_hora_inicial ?? row.valor_hora)),
          valorHora: String(asNumber(row.valor_hora)),
        }
      })
      .filter((row): row is TimesheetRowDraft => row !== null)

    if (parsed.length > 0) return parsed
  }

  return [
    {
      id: item.timesheetId || createDraftRowId(),
      casoId: item.casoId,
      contratoId: item.contratoId,
      dataLancamento: item.timesheetDataLancamento,
      profissional: item.timesheetProfissional,
      atividade: item.timesheetDescricao,
      horasIniciais: String(resolveNumber(item.timesheetHoras, item.horasInformadas)),
      horasRevisadas: String(
        item.status === 'em_aprovacao'
          ? resolveNumber(item.horasAprovadas, item.horasRevisadas)
          : resolveNumber(item.horasRevisadas, item.timesheetHoras),
      ),
      valorHoraInicial: String(item.timesheetValorHora || 0),
      valorHora: String(item.timesheetValorHora || 0),
    },
  ]
}

function getRuleKind(item: RevisaoItem) {
  return asString(item.snapshot?.regra_cobranca || '').trim().toLowerCase()
}

function getRuleTitle(item: RevisaoItem) {
  const kind = getRuleKind(item)
  if (kind === 'mensalidade_processo') return 'Mensalidade de processo'
  if (kind === 'mensal') return 'Mensalidade'
  if (kind === 'projeto' || kind === 'projeto_parcelado') return 'Projeto'
  if (kind === 'exito') return 'Êxito'
  return item.regraNome || 'Regra financeira'
}

function parseSnapshotValueRows(item: RevisaoItem): ValueRowDraft[] {
  const valueRows = Array.isArray(item.snapshot?.valor_itens_revisao) ? (item.snapshot.valor_itens_revisao as unknown[]) : []

  if (valueRows.length > 0) {
    const parsed = valueRows
      .map((entry) => {
        const row = toObject(entry)
        if (!row) return null
        const valorOriginal = asNumber(row.valor_original ?? row.valor_informado ?? row.valor)
        const valorRevisado = asNumber(row.valor_revisado ?? row.valor ?? valorOriginal)
        return {
          id: asString(row.id) || createDraftRowId(),
          referencia: asString(row.referencia || row.data_referencia),
          descricao: asString(row.descricao),
          valorOriginal: String(valorOriginal),
          valorRevisado: String(valorRevisado),
        }
      })
      .filter((row): row is ValueRowDraft => row !== null)
    if (parsed.length > 0) return parsed
  }

  return [
    {
      id: createDraftRowId(),
      referencia: item.dataReferencia || '',
      descricao: getRuleTitle(item),
      valorOriginal: String(resolveNumber(item.valorInformado)),
      valorRevisado: String(getEffectiveItemValue(item)),
    },
  ]
}

function normalizeItem(raw: unknown): RevisaoItem | null {
  if (!raw || typeof raw !== 'object') return null
  const data = raw as Record<string, unknown>

  const id = asString(pickFirstDefined(data.billing_item_id, data.item_id, data.id))
  if (!id) return null

  return {
    id,
    contratoId: asString(data.contrato_id),
    casoId: asString(data.caso_id),
    timesheetId: asString(data.timesheet_id) || null,
    batchId: asString(pickFirstDefined(data.billing_batch_id, data.batch_id)) || null,
    batchNumero: asOptionalNumber(pickFirstDefined(data.batch_numero, data.lote_numero, data.numero_lote)),
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
    responsavelFluxoNome: asString(data.responsavel_fluxo_nome) || null,
    responsavelRevisaoNome: asString(data.responsavel_revisao_nome) || null,
    responsavelAprovacaoNome: asString(data.responsavel_aprovacao_nome) || null,
    timesheetDataLancamento: normalizeDateInput(asString(data.timesheet_data_lancamento)),
    timesheetHoras: asNumber(pickFirstDefined(data.timesheet_horas, data.horas_informadas)),
    timesheetDescricao: asString(data.timesheet_descricao, ''),
    timesheetProfissional: asString(data.timesheet_profissional, ''),
    timesheetValorHora: asNumber(data.timesheet_valor_hora),
    snapshot: toObject(data.snapshot) || {},
  }
}

function formatItemLabel(item: RevisaoItem) {
  const base = item.origemTipo === 'timesheet' ? 'Timesheet' : getRuleTitle(item)
  return `${base} • ${formatDate(item.dataReferencia)}`
}

function getSnapshotTimesheetTotals(item: RevisaoItem) {
  const rawRows = Array.isArray(item.snapshot?.timesheet_itens_revisao) ? (item.snapshot.timesheet_itens_revisao as unknown[]) : []
  if (rawRows.length === 0) return null

  let hours = 0
  let value = 0
  for (const raw of rawRows) {
    const row = toObject(raw)
    if (!row) continue
    const rowHours = asNumber(row.horas_revisadas ?? row.horas ?? row.horas_iniciais)
    const rowValorHora = asNumber(row.valor_hora)
    hours += rowHours
    value += rowHours * rowValorHora
  }

  return {
    hours,
    value,
    count: rawRows.length,
  }
}

function buildTree(items: RevisaoItem[]): ClienteGroup[] {
  const clientes = new Map<string, ClienteGroup>()

  for (const item of items) {
    const clienteKey = item.clienteNome || 'cliente'
    if (!clientes.has(clienteKey)) {
      clientes.set(clienteKey, {
        key: clienteKey,
        nome: item.clienteNome || 'Cliente sem nome',
        totalHoras: 0,
        totalValor: 0,
        contratos: [],
      })
    }

    const cliente = clientes.get(clienteKey)
    if (!cliente) continue
    cliente.totalHoras += getEffectiveItemHours(item)
    cliente.totalValor += getEffectiveItemValue(item)

    const contratoKey = `${item.contratoNumero || 'sem-numero'}-${item.contratoNome}`
    let contrato = cliente.contratos.find((entry) => entry.key === contratoKey)
    if (!contrato) {
      contrato = {
        key: contratoKey,
        contratoId: item.contratoId,
        nome: item.contratoNome,
        numero: item.contratoNumero,
        totalHoras: 0,
        totalValor: 0,
        casos: [],
      }
      cliente.contratos.push(contrato)
    }

    contrato.totalHoras += getEffectiveItemHours(item)
    contrato.totalValor += getEffectiveItemValue(item)

    const casoKey = `${item.casoNumero || 'sem-numero'}-${item.casoNome}`
    let caso = contrato.casos.find((entry) => entry.key === casoKey)
    if (!caso) {
      caso = {
        key: casoKey,
        nome: item.casoNome,
        numero: item.casoNumero,
        totalHoras: 0,
        totalValor: 0,
        itens: [],
      }
      contrato.casos.push(caso)
    }

    caso.totalHoras += getEffectiveItemHours(item)
    caso.totalValor += getEffectiveItemValue(item)
    caso.itens.push(item)
  }

  return Array.from(clientes.values())
}

export default function RevisaoDeFaturaList() {
  const { success, error: toastError } = useToast()
  const { hasPermission } = usePermissions()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState('')
  const [cliente, setCliente] = useState('')
  const [contrato, setContrato] = useState('')
  const [caso, setCaso] = useState('')
  const [items, setItems] = useState<RevisaoItem[]>([])
  const [colaboradorOptions, setColaboradorOptions] = useState<CommandSelectOption[]>([])
  const [colaboradorIdOptions, setColaboradorIdOptions] = useState<CommandSelectOption[]>([])
  const [colaboradorMap, setColaboradorMap] = useState<Map<string, string>>(new Map())
  const [contratoConfigMap, setContratoConfigMap] = useState<Map<string, ContratoTimesheetConfig>>(new Map())

  const [expandedClientes, setExpandedClientes] = useState<Record<string, boolean>>({})
  const [expandedContratos, setExpandedContratos] = useState<Record<string, boolean>>({})
  const [expandedCasos, setExpandedCasos] = useState<Record<string, boolean>>({})

  const [drafts, setDrafts] = useState<Record<string, DraftFields>>({})
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [selectedReviewMode, setSelectedReviewMode] = useState<'default' | 'timesheet'>('default')
  const [selectedClienteKey, setSelectedClienteKey] = useState<string | null>(null)
  const [selectedClienteContractTab, setSelectedClienteContractTab] = useState<string>('')
  const [selectedClienteItemTab, setSelectedClienteItemTab] = useState<string>('')
  const [editingTimesheetItemId, setEditingTimesheetItemId] = useState<string | null>(null)
  const [expandedTimesheetRows, setExpandedTimesheetRows] = useState<Record<string, boolean>>({})
  const [savingItemId, setSavingItemId] = useState<string | null>(null)
  const [movingItemId, setMovingItemId] = useState<string | null>(null)
  const [selectedContratoConfigId, setSelectedContratoConfigId] = useState<string | null>(null)
  const [savingContratoConfig, setSavingContratoConfig] = useState(false)

  const loadItems = async () => {
    try {
      setLoading(true)
      setError(null)
      const supabase = createClient()
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!session) return

      const params = new URLSearchParams()
      if (status) params.set('status', status)
      if (cliente.trim()) params.set('cliente', cliente.trim())
      if (contrato.trim()) params.set('contrato', contrato.trim())
      if (caso.trim()) params.set('caso', caso.trim())

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-revisao-fatura${params.toString() ? `?${params}` : ''}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
        },
      )

      const payload = await response.json()
      if (!response.ok) {
        setError(payload.error || 'Erro ao carregar revisão de fatura')
        setItems([])
        return
      }

      const parsed: RevisaoItem[] = Array.isArray(payload.data)
        ? payload.data
            .map((entry: unknown) => normalizeItem(entry))
            .filter((entry: RevisaoItem | null): entry is RevisaoItem => entry !== null)
        : []

      setItems(parsed)

      const nextDrafts: Record<string, DraftFields> = {}
      for (const item of parsed) {
        const timesheetRows = parseSnapshotTimesheetRows(item)
        const totalHorasRevisadas = timesheetRows.reduce((acc, row) => acc + parseDecimalInput(row.horasRevisadas), 0)
        const totalValorRevisado = timesheetRows.reduce(
          (acc, row) => acc + parseDecimalInput(row.horasRevisadas) * parseDecimalInput(row.valorHora),
          0,
        )

        nextDrafts[item.id] = {
          horas: String(
            item.origemTipo === 'timesheet'
              ? totalHorasRevisadas
              : getEffectiveItemHours(item),
          ),
          valor: String(
            item.origemTipo === 'timesheet'
              ? totalValorRevisado
              : getEffectiveItemValue(item),
          ),
          observacao: '',
          timesheetRows,
          valueRows: parseSnapshotValueRows(item),
        }
      }
      setDrafts(nextDrafts)

      if (selectedItemId && !parsed.some((item) => item.id === selectedItemId)) {
        setSelectedItemId(null)
      }
    } catch (err) {
      console.error(err)
      setError('Erro ao carregar revisão de fatura')
      setItems([])
    } finally {
      setLoading(false)
    }
  }

  const loadColaboradores = async () => {
    try {
      const supabase = createClient()
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session) return

      const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/list-colaboradores`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) return

      const options = Array.isArray(payload.data)
        ? (payload.data as Array<Record<string, unknown>>)
            .filter((entry) => asString(entry.nome))
            .map((entry) => ({
              value: asString(entry.nome),
              label: asString(entry.nome),
              group: asString(entry.categoria),
            }))
        : []
      const idOptions = Array.isArray(payload.data)
        ? (payload.data as Array<Record<string, unknown>>)
            .filter((entry) => asString(entry.nome) && asString(entry.id))
            .map((entry) => ({
              value: asString(entry.id),
              label: asString(entry.nome),
              group: asString(entry.categoria),
            }))
        : []

      setColaboradorOptions(options)
      setColaboradorIdOptions(idOptions)
      const map = new Map<string, string>()
      if (Array.isArray(payload.data)) {
        for (const entry of payload.data as Array<Record<string, unknown>>) {
          const id = asString(entry.id)
          const nome = asString(entry.nome)
          if (id && nome) map.set(id, nome)
        }
      }
      setColaboradorMap(map)
    } catch (err) {
      console.error(err)
      setColaboradorOptions([])
      setColaboradorIdOptions([])
      setColaboradorMap(new Map())
    }
  }

  const loadContratoConfigs = async () => {
    try {
      const supabase = createClient()
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session) return

      const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-contratos?_ts=${Date.now()}`, {
        method: 'GET',
        cache: 'no-store',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || !Array.isArray(payload.data)) {
        setContratoConfigMap(new Map())
        return
      }

      const map = new Map<string, ContratoTimesheetConfig>()
      for (const rawContrato of payload.data as Array<Record<string, unknown>>) {
        const contratoId = asString(rawContrato.id)
        if (!contratoId) continue
        const rawCasos = Array.isArray(rawContrato.casos) ? (rawContrato.casos as Array<Record<string, unknown>>) : []
        map.set(contratoId, {
          id: contratoId,
          numero: asOptionalNumber(rawContrato.numero),
          nome: asString(rawContrato.nome_contrato, 'Contrato sem nome'),
          casos: rawCasos.map((rawCaso) => {
            const timesheetConfig = toObject(rawCaso.timesheet_config) || {}
            const revisoresRaw = Array.isArray(timesheetConfig.revisores) ? (timesheetConfig.revisores as Array<Record<string, unknown>>) : []
            const aprovadoresRaw = Array.isArray(timesheetConfig.aprovadores)
              ? (timesheetConfig.aprovadores as Array<Record<string, unknown>>)
              : []
            return {
              id: asString(rawCaso.id),
              numero: asOptionalNumber(rawCaso.numero),
              nome: asString(rawCaso.nome, 'Caso sem nome'),
              timesheetConfig: {
                revisores: revisoresRaw
                  .map((entry, idx) => ({ colaborador_id: asString(entry.colaborador_id), ordem: asNumber(entry.ordem, idx + 1) }))
                  .filter((entry) => entry.colaborador_id),
                aprovadores: aprovadoresRaw
                  .map((entry, idx) => ({ colaborador_id: asString(entry.colaborador_id), ordem: asNumber(entry.ordem, idx + 1) }))
                  .filter((entry) => entry.colaborador_id),
              },
            }
          }),
        })
      }
      setContratoConfigMap(map)
    } catch (err) {
      console.error(err)
      setContratoConfigMap(new Map())
    }
  }

  useEffect(() => {
    void loadItems()
    void loadColaboradores()
    void loadContratoConfigs()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const tree = useMemo(() => buildTree(items), [items])

  const totals = useMemo(() => {
    return tree.reduce(
      (acc, clienteGroup) => {
        for (const contratoGroup of clienteGroup.contratos) {
          for (const casoGroup of contratoGroup.casos) {
            const caseMetrics = getCaseDisplayMetrics(casoGroup)
            acc.horas += caseMetrics.totalHoras
            acc.valor += caseMetrics.totalValor
            acc.itens += caseMetrics.itemCount
          }
        }
        return acc
      },
      { horas: 0, valor: 0, itens: 0 },
    )
  }, [tree])

  const selectedClienteGroup = useMemo(
    () => (selectedClienteKey ? tree.find((group) => group.key === selectedClienteKey) || null : null),
    [tree, selectedClienteKey],
  )

  const selectedClienteContracts = useMemo<ClienteReviewContractTab[]>(() => {
    if (!selectedClienteGroup) return []

    return selectedClienteGroup.contratos.map((contratoGroup) => {
      const items: ClienteReviewItemTab[] = []
      for (const casoGroup of contratoGroup.casos) {
        const metrics = getCaseDisplayMetrics(casoGroup)
        for (const item of metrics.nonTimesheetItems) {
          items.push({
            key: `item-${item.id}`,
            label: formatItemLabel(item),
            itemId: item.id,
            mode: 'default',
          })
        }
        if (metrics.timesheetAnchorItem) {
          const anchor = metrics.timesheetAnchorItem
          items.push({
            key: `timesheet-${anchor.id}-${casoGroup.key}`,
            label: `Timesheet • ${casoGroup.numero ? `${casoGroup.numero} - ` : ''}${casoGroup.nome}`,
            itemId: anchor.id,
            mode: 'timesheet',
          })
        }
      }

      return {
        key: `contrato-${contratoGroup.contratoId || contratoGroup.key}`,
        label: contratoGroup.numero ? `${contratoGroup.numero} - ${contratoGroup.nome}` : contratoGroup.nome,
        items,
      }
    })
  }, [selectedClienteGroup])

  const selectedItem = useMemo(() => items.find((item) => item.id === selectedItemId) || null, [items, selectedItemId])
  const activeClienteContract = useMemo(
    () => selectedClienteContracts.find((contract) => contract.key === selectedClienteContractTab) || null,
    [selectedClienteContracts, selectedClienteContractTab],
  )
  const activeClienteItem = useMemo(
    () => activeClienteContract?.items.find((item) => item.key === selectedClienteItemTab) || null,
    [activeClienteContract, selectedClienteItemTab],
  )
  const selectedContratoConfig = useMemo(
    () => (selectedContratoConfigId ? contratoConfigMap.get(selectedContratoConfigId) || null : null),
    [contratoConfigMap, selectedContratoConfigId],
  )

  const getResponsavelAtualNome = (item: RevisaoItem) => {
    if (item.status === 'em_revisao' && (item.responsavelFluxoNome || item.responsavelRevisaoNome)) {
      return item.responsavelFluxoNome || item.responsavelRevisaoNome
    }
    if (item.status === 'em_aprovacao' && (item.responsavelFluxoNome || item.responsavelAprovacaoNome)) {
      return item.responsavelFluxoNome || item.responsavelAprovacaoNome
    }

    const snapshot = item.snapshot || {}
    const snapshotFluxo = asString(snapshot.responsavel_fluxo_nome)
    const snapshotRevisor = asString(snapshot.responsavel_revisao_nome)
    const snapshotAprovador = asString(snapshot.responsavel_aprovacao_nome)

    if (item.status === 'em_revisao' && (snapshotFluxo || snapshotRevisor)) return snapshotFluxo || snapshotRevisor
    if (item.status === 'em_aprovacao' && (snapshotFluxo || snapshotAprovador)) return snapshotFluxo || snapshotAprovador

    const contratoConfig = contratoConfigMap.get(item.contratoId)
    const caso = contratoConfig?.casos.find((entry) => entry.id === item.casoId)
    if (!caso) return null
    if (item.status === 'em_revisao') {
      const revisor = [...(caso.timesheetConfig.revisores || [])].sort((a, b) => a.ordem - b.ordem)[0]
      if (!revisor) return null
      return colaboradorMap.get(revisor.colaborador_id) || revisor.colaborador_id
    }
    if (item.status === 'em_aprovacao') {
      const aprovador = [...(caso.timesheetConfig.aprovadores || [])].sort((a, b) => a.ordem - b.ordem)[0]
      if (!aprovador) return null
      return colaboradorMap.get(aprovador.colaborador_id) || aprovador.colaborador_id
    }
    return null
  }

  const getResponsavelDaVez = (item: RevisaoItem) => {
    const nome = getResponsavelAtualNome(item)
    if (!nome) return null
    if (item.status === 'em_revisao') return `Revisor: ${nome}`
    if (item.status === 'em_aprovacao') return `Aprovador: ${nome}`
    return nome
  }

  const summarizeStatusAndResponsavel = (groupItems: RevisaoItem[]) => {
    const statusSet = new Set<string>()
    const responsavelSet = new Set<string>()
    for (const item of groupItems) {
      statusSet.add(formatStatus(item.status))
      const responsavel = getResponsavelAtualNome(item)
      if (responsavel) responsavelSet.add(responsavel)
    }
    return {
      status: statusSet.size === 0 ? '-' : statusSet.size === 1 ? Array.from(statusSet)[0] : 'Múltiplos',
      responsavel:
        responsavelSet.size === 0 ? '-' : responsavelSet.size === 1 ? Array.from(responsavelSet)[0] : 'Múltiplos',
    }
  }

  function getCaseDisplayMetrics(casoGroup: CasoGroup): CaseDisplayMetrics {
    const timesheetItems = casoGroup.itens.filter((entry) => entry.origemTipo === 'timesheet')
    const nonTimesheetItems = casoGroup.itens.filter((entry) => entry.origemTipo !== 'timesheet')
    const snapshotCarrier =
      casoGroup.itens.find((entry) => {
        const raw = Array.isArray(entry.snapshot?.timesheet_itens_revisao) ? (entry.snapshot.timesheet_itens_revisao as unknown[]) : []
        return raw.length > 0
      }) || null

    const snapshotTotals = snapshotCarrier ? getSnapshotTimesheetTotals(snapshotCarrier) : null
    const fallbackTimesheetHours = timesheetItems.reduce((acc, item) => acc + getEffectiveItemHours(item), 0)
    const fallbackTimesheetValue = timesheetItems.reduce((acc, item) => acc + getEffectiveItemValue(item), 0)
    const timesheetHours = snapshotTotals ? snapshotTotals.hours : fallbackTimesheetHours
    const timesheetValue = snapshotTotals ? snapshotTotals.value : fallbackTimesheetValue
    const timesheetItemCount =
      snapshotTotals?.count ?? (timesheetItems.length > 0 ? timesheetItems.length : snapshotCarrier || casoGroup.itens.length > 0 ? 1 : 0)

    const nonTimesheetHours = nonTimesheetItems.reduce((acc, item) => acc + getEffectiveItemHours(item), 0)
    const nonTimesheetValue = nonTimesheetItems.reduce((acc, item) => acc + getEffectiveItemValue(item), 0)
    const hasTimesheetLine = Boolean(snapshotCarrier || timesheetItems.length > 0 || casoGroup.itens.length > 0)

    return {
      totalHoras: nonTimesheetHours + (hasTimesheetLine ? timesheetHours : 0),
      totalValor: nonTimesheetValue + (hasTimesheetLine ? timesheetValue : 0),
      itemCount: nonTimesheetItems.length + (hasTimesheetLine ? 1 : 0),
      timesheetHours: hasTimesheetLine ? timesheetHours : 0,
      timesheetValue: hasTimesheetLine ? timesheetValue : 0,
      timesheetItemCount: hasTimesheetLine ? Math.max(timesheetItemCount, 1) : 0,
      timesheetAnchorItem: snapshotCarrier || timesheetItems[0] || casoGroup.itens[0] || null,
      nonTimesheetItems,
    }
  }

  const updateDraft = (itemId: string, patch: Partial<DraftFields>) => {
    setDrafts((prev) => ({
      ...prev,
      [itemId]: {
        horas: prev[itemId]?.horas || '0',
        valor: prev[itemId]?.valor || '0',
        observacao: prev[itemId]?.observacao || '',
        timesheetRows: prev[itemId]?.timesheetRows || [],
        valueRows: prev[itemId]?.valueRows || [],
        ...patch,
      },
    }))
  }

  const openReviewModal = (itemId: string, mode: 'default' | 'timesheet' = 'default') => {
    setSelectedItemId(itemId)
    setSelectedReviewMode(mode)
    setEditingTimesheetItemId(null)
    setExpandedTimesheetRows({})
  }

  const openClienteReviewModal = (clienteKey: string) => {
    setSelectedClienteKey(clienteKey)
  }

  useEffect(() => {
    if (!selectedClienteKey) return
    const firstContract = selectedClienteContracts[0]
    if (!firstContract) {
      setSelectedClienteContractTab('')
      setSelectedClienteItemTab('')
      return
    }

    if (!selectedClienteContractTab || !selectedClienteContracts.some((contract) => contract.key === selectedClienteContractTab)) {
      setSelectedClienteContractTab(firstContract.key)
      setSelectedClienteItemTab(firstContract.items[0]?.key || '')
      return
    }

    const activeContract = selectedClienteContracts.find((contract) => contract.key === selectedClienteContractTab) || firstContract
    if (!activeContract.items.some((item) => item.key === selectedClienteItemTab)) {
      setSelectedClienteItemTab(activeContract.items[0]?.key || '')
    }
  }, [selectedClienteKey, selectedClienteContracts, selectedClienteContractTab, selectedClienteItemTab])

  useEffect(() => {
    if (!selectedClienteKey || !activeClienteItem) return
    setSelectedItemId(activeClienteItem.itemId)
    setSelectedReviewMode(activeClienteItem.mode)
    setEditingTimesheetItemId(null)
    setExpandedTimesheetRows({})
  }, [selectedClienteKey, activeClienteItem])

  const updateTimesheetRow = (itemId: string, rowId: string, patch: Partial<TimesheetRowDraft>) => {
    setDrafts((prev) => {
      const current = prev[itemId]
      if (!current) return prev

      return {
        ...prev,
        [itemId]: {
          ...current,
          timesheetRows: (current.timesheetRows || []).map((row) => (row.id === rowId ? { ...row, ...patch } : row)),
        },
      }
    })
  }

  const addTimesheetRow = (itemId: string) => {
    const sourceItem = items.find((item) => item.id === itemId)
    const row: TimesheetRowDraft = {
      id: createDraftRowId(),
      casoId: sourceItem?.casoId || '',
      contratoId: sourceItem?.contratoId || '',
      dataLancamento: '',
      profissional: '',
      atividade: '',
      horasIniciais: '0',
      horasRevisadas: '0',
      valorHoraInicial: '0',
      valorHora: '0',
    }
    setDrafts((prev) => {
      const current = prev[itemId]
      if (!current) return prev
      return {
        ...prev,
        [itemId]: {
          ...current,
          timesheetRows: [...(current.timesheetRows || []), row],
        },
      }
    })
    setEditingTimesheetItemId(row.id)
  }

  const updateValueRow = (itemId: string, rowId: string, patch: Partial<ValueRowDraft>) => {
    setDrafts((prev) => {
      const current = prev[itemId]
      if (!current) return prev
      return {
        ...prev,
        [itemId]: {
          ...current,
          valueRows: (current.valueRows || []).map((row) => (row.id === rowId ? { ...row, ...patch } : row)),
        },
      }
    })
  }

  const addValueRow = (itemId: string) => {
    const row: ValueRowDraft = {
      id: createDraftRowId(),
      referencia: '',
      descricao: 'Parcela',
      valorOriginal: '0',
      valorRevisado: '0',
    }
    setDrafts((prev) => {
      const current = prev[itemId]
      if (!current) return prev
      return {
        ...prev,
        [itemId]: {
          ...current,
          valueRows: [...(current.valueRows || []), row],
        },
      }
    })
    setEditingTimesheetItemId(row.id)
  }

  const removeValueRow = (itemId: string, rowId: string) => {
    setDrafts((prev) => {
      const current = prev[itemId]
      if (!current) return prev
      const nextRows = (current.valueRows || []).filter((row) => row.id !== rowId)
      return {
        ...prev,
        [itemId]: {
          ...current,
          valueRows: nextRows.length > 0 ? nextRows : current.valueRows,
        },
      }
    })
    setEditingTimesheetItemId((current) => (current === rowId ? null : current))
  }

  const updateCasoFluxo = (
    casoId: string,
    field: 'revisores' | 'aprovadores',
    updater: (entries: FluxoResponsavel[]) => FluxoResponsavel[],
  ) => {
    setContratoConfigMap((prev) => {
      if (!selectedContratoConfigId) return prev
      const contrato = prev.get(selectedContratoConfigId)
      if (!contrato) return prev
      const nextCasos = contrato.casos.map((caso) => {
        if (caso.id !== casoId) return caso
        const current = caso.timesheetConfig[field] || []
        const updated = updater(current).map((entry, idx) => ({ ...entry, ordem: entry.ordem || idx + 1 }))
        return {
          ...caso,
          timesheetConfig: {
            ...caso.timesheetConfig,
            [field]: updated,
          },
        }
      })
      const next = new Map(prev)
      next.set(selectedContratoConfigId, { ...contrato, casos: nextCasos })
      return next
    })
  }

  const saveContratoConfig = async () => {
    if (!selectedContratoConfig) return
    try {
      setSavingContratoConfig(true)
      const supabase = createClient()
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session) return

      for (const caso of selectedContratoConfig.casos) {
        const payload = {
          id: caso.id,
          timesheet_config: {
            revisores: [...(caso.timesheetConfig.revisores || [])]
              .sort((a, b) => a.ordem - b.ordem)
              .map((entry, idx) => ({ colaborador_id: entry.colaborador_id, ordem: idx + 1 })),
            aprovadores: [...(caso.timesheetConfig.aprovadores || [])]
              .sort((a, b) => a.ordem - b.ordem)
              .map((entry, idx) => ({ colaborador_id: entry.colaborador_id, ordem: idx + 1 })),
          },
        }

        const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/update-caso`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        })
        const result = await response.json().catch(() => ({}))
        if (!response.ok) {
          toastError(result.error || `Erro ao salvar responsáveis do caso ${caso.nome}`)
          return
        }
      }

      success('Revisores/aprovadores atualizados com sucesso.')
      setSelectedContratoConfigId(null)
      await loadContratoConfigs()
    } catch (err) {
      console.error(err)
      toastError('Erro ao salvar revisores/aprovadores')
    } finally {
      setSavingContratoConfig(false)
    }
  }

  const removeTimesheetRow = (itemId: string, rowId: string) => {
    setDrafts((prev) => {
      const current = prev[itemId]
      if (!current) return prev
      const nextRows = (current.timesheetRows || []).filter((row) => row.id !== rowId)
      return {
        ...prev,
        [itemId]: {
          ...current,
          timesheetRows: nextRows.length > 0 ? nextRows : current.timesheetRows,
        },
      }
    })
    setEditingTimesheetItemId((current) => (current === rowId ? null : current))
  }

  const saveItem = async (item: RevisaoItem) => {
    try {
      setSavingItemId(item.id)
      const draft = drafts[item.id] || {
        horas: '0',
        valor: '0',
        observacao: '',
        timesheetRows: [],
        valueRows: [],
      }

      const timesheetRows = draft.timesheetRows || []
      const valueRows = draft.valueRows || []
      const totalHorasRevisadas = timesheetRows.reduce((acc, row) => acc + parseDecimalInput(row.horasRevisadas), 0)
      const totalValorRevisado = timesheetRows.reduce(
        (acc, row) => acc + parseDecimalInput(row.horasRevisadas) * parseDecimalInput(row.valorHora),
        0,
      )
      const totalRevisadoRegra = valueRows.reduce((acc, row) => acc + parseDecimalInput(row.valorRevisado), 0)
      const firstRow = timesheetRows[0]
      const isTimesheetMode = (selectedItemId === item.id && selectedReviewMode === 'timesheet') || item.origemTipo === 'timesheet'
      const snapshotPatch =
        isTimesheetMode
          ? {
              timesheet_itens_revisao: timesheetRows.map((row) => ({
                id: row.id,
                caso_id: row.casoId || item.casoId,
                contrato_id: row.contratoId || item.contratoId,
                data_lancamento: row.dataLancamento || null,
                profissional: row.profissional || '',
                atividade: row.atividade || '',
                horas_iniciais: parseDecimalInput(row.horasIniciais),
                horas_revisadas: parseDecimalInput(row.horasRevisadas),
                valor_hora_inicial: parseDecimalInput(row.valorHoraInicial),
                valor_hora: parseDecimalInput(row.valorHora),
              })),
              timesheet_data_lancamento: firstRow?.dataLancamento || null,
              timesheet_horas: parseDecimalInput(firstRow?.horasIniciais || '0'),
              timesheet_descricao: firstRow?.atividade || '',
              timesheet_profissional: firstRow?.profissional || '',
              timesheet_valor_hora: parseDecimalInput(firstRow?.valorHora || '0'),
            }
          : {
              valor_itens_revisao: valueRows.map((row) => ({
                id: row.id,
                referencia: normalizeDateFromDisplay(row.referencia || '') || row.referencia || null,
                descricao: row.descricao || '',
                valor_original: parseDecimalInput(row.valorOriginal),
                valor_revisado: parseDecimalInput(row.valorRevisado),
              })),
            }

      const supabase = createClient()
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session) return false

      const body: Record<string, unknown> = {
        billing_item_id: item.id,
        observacao: draft.observacao || null,
        snapshot_patch: snapshotPatch,
      }
      if (isTimesheetMode && item.origemTipo !== 'timesheet') {
        body.review_mode = 'timesheet'
      }

      const targetHours = isTimesheetMode ? totalHorasRevisadas : getEffectiveItemHours(item)
      const targetValue =
        isTimesheetMode
          ? totalValorRevisado
          : valueRows.length > 0
            ? totalRevisadoRegra
            : getEffectiveItemValue(item)
      if (item.status === 'em_aprovacao') {
        body.horas_aprovadas = targetHours
        body.valor_aprovado = targetValue
      } else {
        body.horas_revisadas = targetHours
        body.valor_revisado = targetValue
      }

      const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/update-revisao-fatura-item`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })

      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        toastError(payload.error || 'Erro ao salvar item da revisão')
        return false
      }

      success('Revisão salva com sucesso.')
      await loadItems()
      return true
    } catch (err) {
      console.error(err)
      toastError('Erro ao salvar item da revisão')
      return false
    } finally {
      setSavingItemId(null)
    }
  }

  const moveStatus = async (item: RevisaoItem, action: 'avancar' | 'retornar') => {
    try {
      setMovingItemId(item.id)
      const supabase = createClient()
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session) return false

      const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/set-revisao-fatura-status`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          billing_item_id: item.id,
          action,
        }),
      })

      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        toastError(payload.error || 'Erro ao atualizar etapa do item')
        return false
      }

      success(action === 'avancar' ? 'Item avançado para próxima etapa.' : 'Item retornado para etapa anterior.')
      await loadItems()
      return true
    } catch (err) {
      console.error(err)
      toastError('Erro ao atualizar etapa do item')
      return false
    } finally {
      setMovingItemId(null)
    }
  }

  const getAdvanceActionLabel = (item: RevisaoItem) => {
    const contratoConfig = contratoConfigMap.get(item.contratoId)
    const caso = contratoConfig?.casos.find((entry) => entry.id === item.casoId)
    const responsavelAtual = getResponsavelAtualNome(item)

    if (item.status === 'em_revisao') {
      const revisores = [...(caso?.timesheetConfig.revisores || [])].sort((a, b) => a.ordem - b.ordem)
      if (revisores.length <= 1) return 'Enviar para aprovação'
      const idx = revisores.findIndex((entry) => {
        const nome = colaboradorMap.get(entry.colaborador_id) || entry.colaborador_id
        return responsavelAtual ? nome === responsavelAtual : false
      })
      const hasNext = idx >= 0 ? idx < revisores.length - 1 : revisores.length > 1
      return hasNext ? 'Avançar para próximo revisor' : 'Enviar para aprovação'
    }

    if (item.status === 'em_aprovacao') {
      const aprovadores = [...(caso?.timesheetConfig.aprovadores || [])].sort((a, b) => a.ordem - b.ordem)
      if (aprovadores.length <= 1) return 'Aprovar'
      const idx = aprovadores.findIndex((entry) => {
        const nome = colaboradorMap.get(entry.colaborador_id) || entry.colaborador_id
        return responsavelAtual ? nome === responsavelAtual : false
      })
      const hasNext = idx >= 0 ? idx < aprovadores.length - 1 : aprovadores.length > 1
      return hasNext ? 'Avançar para próximo aprovador' : 'Aprovar'
    }

    return 'Avançar'
  }

  const saveAndAdvanceItem = async (item: RevisaoItem) => {
    const saved = await saveItem(item)
    if (!saved) return
    await moveStatus(item, 'avancar')
  }

  const canAdvance = (statusValue: string) => statusValue === 'em_revisao' || statusValue === 'em_aprovacao'
  const canReturn = (statusValue: string) => statusValue === 'em_aprovacao' || statusValue === 'aprovado'

  const selectedDraft = selectedItem ? drafts[selectedItem.id] : null
  const modalBusy = selectedItem ? savingItemId === selectedItem.id || movingItemId === selectedItem.id : false
  const itemLocked = selectedItem ? ['aprovado', 'faturado', 'cancelado'].includes(selectedItem.status) : false
  const editDisabled = modalBusy || itemLocked
  const isTimesheetMode = selectedItem ? selectedReviewMode === 'timesheet' || selectedItem.origemTipo === 'timesheet' : false
  const selectedTimesheetRows = selectedDraft?.timesheetRows || []
  const selectedValueRows = selectedDraft?.valueRows || []
  const caseTransferMap = useMemo(() => {
    const caseToContrato = new Map<string, string>()
    const optionsMap = new Map<string, CommandSelectOption>()
    for (const item of items) {
      if (!item.casoId) continue
      caseToContrato.set(item.casoId, item.contratoId)
      if (optionsMap.has(item.casoId)) continue
      const contratoLabel = item.contratoNumero ? `${item.contratoNumero} - ${item.contratoNome}` : item.contratoNome
      const casoLabel = item.casoNumero ? `${item.casoNumero} - ${item.casoNome}` : item.casoNome
      optionsMap.set(item.casoId, {
        value: item.casoId,
        label: casoLabel,
        group: `${item.clienteNome} • ${contratoLabel}`,
      })
    }
    return {
      caseToContrato,
      options: Array.from(optionsMap.values()).sort((a, b) => a.label.localeCompare(b.label, 'pt-BR')),
    }
  }, [items])
  const canManageReviewers = useMemo(
    () =>
      hasPermission('finance.faturamento.manage') ||
      hasPermission('finance.faturamento.*') ||
      hasPermission('finance.*') ||
      hasPermission('*'),
    [hasPermission],
  )
  const groupedTimesheetRows = useMemo(() => {
    const sorted = [...selectedTimesheetRows].sort((a, b) => {
      const aDate = a.dataLancamento || ''
      const bDate = b.dataLancamento || ''
      return bDate.localeCompare(aDate)
    })

    const groups = new Map<string, TimesheetRowDraft[]>()
    for (const row of sorted) {
      const key = row.dataLancamento || 'sem-data'
      const current = groups.get(key) || []
      current.push(row)
      groups.set(key, current)
    }

    return Array.from(groups.entries()).map(([key, rows]) => ({
      key,
      label: key === 'sem-data' ? 'Sem data de lançamento' : formatDate(key),
      rows,
    }))
  }, [selectedTimesheetRows])
  const totalHorasIniciais = selectedTimesheetRows.reduce((acc, row) => acc + parseDecimalInput(row.horasIniciais), 0)
  const totalHorasRevisadas = selectedTimesheetRows.reduce((acc, row) => acc + parseDecimalInput(row.horasRevisadas), 0)
  const valorInicialTimesheet = selectedTimesheetRows.reduce(
    (acc, row) => acc + parseDecimalInput(row.horasIniciais) * parseDecimalInput(row.valorHoraInicial),
    0,
  )
  const valorSugerido = selectedTimesheetRows.reduce(
    (acc, row) => acc + parseDecimalInput(row.horasRevisadas) * parseDecimalInput(row.valorHora),
    0,
  )
  const valorOriginalRegras = selectedValueRows.reduce((acc, row) => acc + parseDecimalInput(row.valorOriginal), 0)
  const valorRevisadoRegras = selectedValueRows.reduce((acc, row) => acc + parseDecimalInput(row.valorRevisado), 0)

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

  return (
    <div className="space-y-4">
      {error ? (
        <Alert className="border-red-200 bg-red-50 text-red-700">
          <AlertTitle>Atenção</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-3 md:grid-cols-5">
        <div className="space-y-1">
          <label className="text-sm font-medium">Status</label>
          <NativeSelect value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">Todos</option>
            <option value="em_revisao">Em revisão</option>
            <option value="em_aprovacao">Em aprovação</option>
            <option value="aprovado">Aprovado</option>
            <option value="faturado">Faturado</option>
            <option value="cancelado">Cancelado</option>
          </NativeSelect>
        </div>
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
        <div className="font-semibold">{formatMoney(totals.valor)}</div>
      </div>

      <div className="overflow-hidden rounded-md border bg-white">
        <Table className="w-full min-w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Cliente / Contrato / Caso</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Horas em aberto</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Itens</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Status</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Responsável atual</th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase text-gray-500">Valor em aberto</th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase text-gray-500">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-muted-foreground">
                  Carregando revisão de fatura...
                </td>
              </tr>
            ) : tree.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-muted-foreground">
                  Nenhum item em revisão encontrado para os filtros informados.
                </td>
              </tr>
            ) : (
              tree.map((clienteGroup) => {
                const clienteExpanded = expandedClientes[clienteGroup.key]
                const clienteItems = clienteGroup.contratos.flatMap((contratoGroup) => contratoGroup.casos.flatMap((casoGroup) => casoGroup.itens))
                const clienteSummary = summarizeStatusAndResponsavel(clienteItems)
                const clienteMetrics = clienteGroup.contratos.reduce(
                  (acc, contratoGroup) => {
                    const contratoMetrics = contratoGroup.casos.reduce(
                      (accContrato, casoGroup) => {
                        const caseMetrics = getCaseDisplayMetrics(casoGroup)
                        accContrato.horas += caseMetrics.totalHoras
                        accContrato.valor += caseMetrics.totalValor
                        accContrato.itens += caseMetrics.itemCount
                        return accContrato
                      },
                      { horas: 0, valor: 0, itens: 0 },
                    )
                    acc.horas += contratoMetrics.horas
                    acc.valor += contratoMetrics.valor
                    acc.itens += contratoMetrics.itens
                    return acc
                  },
                  { horas: 0, valor: 0, itens: 0 },
                )

                return (
                  <Fragment key={clienteGroup.key}>
                    <tr className="bg-muted/10">
                      <td className="px-4 py-3 font-semibold">
                        <button
                          className="inline-flex items-center gap-2"
                          onClick={() =>
                            setExpandedClientes((prev) => ({
                              ...prev,
                              [clienteGroup.key]: !clienteExpanded,
                            }))
                          }
                        >
                          {clienteExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          {clienteGroup.nome}
                        </button>
                      </td>
                      <td className="px-4 py-3">{formatHours(clienteMetrics.horas)}</td>
                      <td className="px-4 py-3">{clienteMetrics.itens}</td>
                      <td className="px-4 py-3">{clienteSummary.status}</td>
                      <td className="px-4 py-3">{clienteSummary.responsavel}</td>
                      <td className="px-4 py-3 text-right">{formatMoney(clienteMetrics.valor)}</td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end">
                          <Tooltip content="Revisar cliente">
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => openClienteReviewModal(clienteGroup.key)}
                              disabled={clienteMetrics.itens <= 0}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                          </Tooltip>
                        </div>
                      </td>
                    </tr>

                    {clienteExpanded &&
                      clienteGroup.contratos.map((contratoGroup) => {
                        const contratoExpanded = expandedContratos[contratoGroup.key]
                        const contratoItems = contratoGroup.casos.flatMap((casoGroup) => casoGroup.itens)
                        const contratoSummary = summarizeStatusAndResponsavel(contratoItems)
                        const contratoMetrics = contratoGroup.casos.reduce(
                          (acc, casoGroup) => {
                            const caseMetrics = getCaseDisplayMetrics(casoGroup)
                            acc.horas += caseMetrics.totalHoras
                            acc.valor += caseMetrics.totalValor
                            acc.itens += caseMetrics.itemCount
                            return acc
                          },
                          { horas: 0, valor: 0, itens: 0 },
                        )

                        return (
                          <Fragment key={`${clienteGroup.key}-${contratoGroup.key}`}>
                            <tr>
                              <td className="px-4 py-3 pl-10">
                                <button
                                  className="inline-flex items-center gap-2"
                                  onClick={() =>
                                    setExpandedContratos((prev) => ({
                                      ...prev,
                                      [contratoGroup.key]: !contratoExpanded,
                                    }))
                                  }
                                >
                                  {contratoExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                  {contratoGroup.numero ? `${contratoGroup.numero} - ` : ''}
                                  {contratoGroup.nome}
                                </button>
                              </td>
                              <td className="px-4 py-3">{formatHours(contratoMetrics.horas)}</td>
                              <td className="px-4 py-3">{contratoMetrics.itens}</td>
                              <td className="px-4 py-3">{contratoSummary.status}</td>
                              <td className="px-4 py-3">{contratoSummary.responsavel}</td>
                              <td className="px-4 py-3 text-right">{formatMoney(contratoMetrics.valor)}</td>
                              <td className="px-4 py-3 text-right text-xs text-muted-foreground">-</td>
                            </tr>

                            {contratoExpanded &&
                              contratoGroup.casos.map((casoGroup) => {
                                const casoExpanded = expandedCasos[casoGroup.key]
                                const caseMetrics = getCaseDisplayMetrics(casoGroup)
                                const casoSummary = summarizeStatusAndResponsavel(casoGroup.itens)

                                return (
                                  <Fragment key={`${clienteGroup.key}-${contratoGroup.key}-${casoGroup.key}`}>
                                    <tr>
                                      <td className="px-4 py-3 pl-16 text-muted-foreground">
                                        <button
                                          className="inline-flex items-center gap-2"
                                          onClick={() =>
                                            setExpandedCasos((prev) => ({
                                              ...prev,
                                              [casoGroup.key]: !casoExpanded,
                                            }))
                                          }
                                        >
                                          {casoExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                          {casoGroup.numero ? `${casoGroup.numero} - ` : ''}
                                          {casoGroup.nome}
                                        </button>
                                      </td>
                                      <td className="px-4 py-3 text-muted-foreground">{formatHours(caseMetrics.totalHoras)}</td>
                                      <td className="px-4 py-3 text-muted-foreground">{caseMetrics.itemCount}</td>
                                      <td className="px-4 py-3 text-muted-foreground">{casoSummary.status}</td>
                                      <td className="px-4 py-3 text-muted-foreground">{casoSummary.responsavel}</td>
                                      <td className="px-4 py-3 text-right text-muted-foreground">{formatMoney(caseMetrics.totalValor)}</td>
                                      <td className="px-4 py-3 text-right text-xs text-muted-foreground">-</td>
                                    </tr>

                                    {casoExpanded &&
                                      (() => {
                                        const baseItem = caseMetrics.timesheetAnchorItem
                                        const timesheetBusy = casoGroup.itens
                                          .filter((entry) => entry.origemTipo === 'timesheet')
                                          .some(
                                          (entry) => savingItemId === entry.id || movingItemId === entry.id,
                                        )
                                        return (
                                          <>
                                            {caseMetrics.nonTimesheetItems.map((item) => {
                                              const busy = savingItemId === item.id || movingItemId === item.id

                                              return (
                                                <tr key={item.id} className="bg-muted/5">
                                                  <td className="px-4 py-3 pl-24 text-xs text-muted-foreground">
                                                    <div className="max-w-[460px] truncate">
                                                      {formatItemLabel(item)}
                                                      {item.timesheetDescricao ? ` • ${item.timesheetDescricao}` : ''}
                                                    </div>
                                                  </td>
                                                  <td className="px-4 py-3 text-xs">{formatHours(getEffectiveItemHours(item))}</td>
                                                  <td className="px-4 py-3 text-xs">1</td>
                                                  <td className="px-4 py-3 text-xs">{formatStatus(item.status)}</td>
                                                  <td className="px-4 py-3 text-xs">{getResponsavelAtualNome(item) || '-'}</td>
                                                  <td className="px-4 py-3 text-right text-xs">{formatMoney(getEffectiveItemValue(item))}</td>
                                                  <td className="px-4 py-3">
                                                    <div className="flex flex-wrap items-center justify-end gap-2">
                                                      {canManageReviewers ? (
                                                        <Tooltip content="Configurar revisores/aprovadores">
                                                          <Button
                                                            size="icon"
                                                            variant="ghost"
                                                            onClick={() => setSelectedContratoConfigId(item.contratoId || null)}
                                                            disabled={busy || !item.contratoId}
                                                          >
                                                            <Settings2 className="h-4 w-4" />
                                                          </Button>
                                                        </Tooltip>
                                                      ) : null}
                                                      <Tooltip content={item.status === 'em_aprovacao' ? 'Aprovar item' : 'Revisar item'}>
                                                        <Button
                                                          size="icon"
                                                          variant="ghost"
                                                          onClick={() => openReviewModal(item.id)}
                                                          disabled={busy}
                                                        >
                                                          {item.status === 'em_aprovacao' ? <Check className="h-4 w-4" /> : <SquarePen className="h-4 w-4" />}
                                                        </Button>
                                                      </Tooltip>
                                                    </div>
                                                  </td>
                                                </tr>
                                              )
                                            })}

                                            {baseItem ? (
                                              <tr key={`synthetic-timesheet-${casoGroup.key}`} className="bg-muted/5">
                                                <td className="px-4 py-3 pl-24 text-xs text-muted-foreground">
                                                  <div className="max-w-[460px] truncate">Timesheet</div>
                                                </td>
                                                <td className="px-4 py-3 text-xs">{formatHours(caseMetrics.timesheetHours)}</td>
                                                <td className="px-4 py-3 text-xs">{caseMetrics.timesheetItemCount}</td>
                                                <td className="px-4 py-3 text-xs">{formatStatus(baseItem.status)}</td>
                                                <td className="px-4 py-3 text-xs">{getResponsavelAtualNome(baseItem) || '-'}</td>
                                                <td className="px-4 py-3 text-right text-xs">{formatMoney(caseMetrics.timesheetValue)}</td>
                                                <td className="px-4 py-3">
                                                  <div className="flex flex-wrap items-center justify-end gap-2">
                                                    {canManageReviewers ? (
                                                      <Tooltip content="Configurar revisores/aprovadores">
                                                        <Button
                                                          size="icon"
                                                          variant="ghost"
                                                          onClick={() => setSelectedContratoConfigId(baseItem.contratoId || null)}
                                                          disabled={!baseItem.contratoId || timesheetBusy}
                                                        >
                                                          <Settings2 className="h-4 w-4" />
                                                        </Button>
                                                      </Tooltip>
                                                    ) : null}
                                                    <Tooltip content={baseItem.status === 'em_aprovacao' ? 'Aprovar timesheet' : 'Revisar timesheet'}>
                                                      <Button
                                                        size="icon"
                                                        variant="ghost"
                                                        onClick={() => openReviewModal(baseItem.id, 'timesheet')}
                                                        disabled={timesheetBusy}
                                                      >
                                                        {baseItem.status === 'em_aprovacao' ? <Check className="h-4 w-4" /> : <SquarePen className="h-4 w-4" />}
                                                      </Button>
                                                    </Tooltip>
                                                  </div>
                                                </td>
                                              </tr>
                                            ) : null}
                                          </>
                                        )
                                      })()}
                                  </Fragment>
                                )
                              })}
                          </Fragment>
                        )
                      })}
                  </Fragment>
                )
              })
            )}
          </tbody>
        </Table>
      </div>

      <Dialog
        open={!!selectedClienteGroup}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedClienteKey(null)
            setSelectedClienteContractTab('')
            setSelectedClienteItemTab('')
          }
        }}
      >
        <DialogContent className="max-w-6xl">
          <DialogHeader>
            <DialogTitle>Revisão do cliente</DialogTitle>
            <DialogDescription>{selectedClienteGroup?.nome || ''}</DialogDescription>
          </DialogHeader>

          {selectedClienteGroup ? (
            <Tabs
              defaultValue={selectedClienteContracts[0]?.key || '__none__'}
              value={selectedClienteContractTab}
              onValueChange={(value) => {
                setSelectedClienteContractTab(value)
                const contract = selectedClienteContracts.find((entry) => entry.key === value)
                setSelectedClienteItemTab(contract?.items[0]?.key || '')
              }}
              className="space-y-4"
            >
              <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto">
                {selectedClienteContracts.map((contract) => (
                  <TabsTrigger key={contract.key} value={contract.key}>
                    {contract.label}
                  </TabsTrigger>
                ))}
              </TabsList>

              {selectedClienteContracts.map((contract) => (
                <TabsContent key={contract.key} value={contract.key} className="space-y-3">
                  {contract.items.length === 0 ? (
                    <div className="rounded-md border bg-muted/20 p-3 text-sm text-muted-foreground">
                      Nenhum item disponível para este contrato.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <Tabs
                        defaultValue={contract.items[0]?.key || '__none__'}
                        value={selectedClienteItemTab}
                        onValueChange={(value) => {
                          setSelectedClienteItemTab(value)
                          const nextTab = contract.items.find((entry) => entry.key === value)
                          if (nextTab) {
                            setSelectedItemId(nextTab.itemId)
                            setSelectedReviewMode(nextTab.mode)
                            setEditingTimesheetItemId(null)
                            setExpandedTimesheetRows({})
                          }
                        }}
                        className="space-y-3"
                      >
                        <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto">
                          {contract.items.map((itemTab) => (
                            <TabsTrigger key={itemTab.key} value={itemTab.key}>
                              {itemTab.label}
                            </TabsTrigger>
                          ))}
                        </TabsList>
                      </Tabs>
                    </div>
                  )}
                </TabsContent>
              ))}
            </Tabs>
          ) : null}

          {selectedClienteGroup && selectedItem && selectedDraft ? (
            <div className="space-y-4 border-t pt-3">
              {itemLocked ? (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  Item em status <strong>{formatStatus(selectedItem.status)}</strong>. Edição bloqueada.
                </div>
              ) : null}
              <div className="rounded-md border p-3 text-sm">
                <p className="font-medium">{formatItemLabel(selectedItem)}</p>
                <p className="mt-1 text-muted-foreground">
                  {`${formatStatus(selectedItem.status)} • ${getResponsavelDaVez(selectedItem) || 'Sem responsável definido'}`}
                </p>
              </div>

              {isTimesheetMode ? (
                <>
                  <div className="flex items-center justify-end">
                    <Button variant="outline" onClick={() => addTimesheetRow(selectedItem.id)} disabled={editDisabled}>
                      <Plus className="mr-2 h-4 w-4" />
                      Adicionar timesheet
                    </Button>
                  </div>

                  <div className="space-y-3">
                    {groupedTimesheetRows.map((group) => (
                      <div key={group.key} className="overflow-visible rounded-md border">
                        <div className="border-b bg-muted/20 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          {group.label} • {group.rows.length} lançamento{group.rows.length > 1 ? 's' : ''}
                        </div>
                        <ul className="divide-y">
                          {group.rows.map((row) => {
                            const rowEditing = editingTimesheetItemId === row.id
                            const rowExpanded = !!expandedTimesheetRows[row.id]
                            return (
                              <li key={row.id} className={`p-3 ${rowEditing ? 'bg-primary/5' : ''}`}>
                                <div className="mb-2 flex items-center justify-between">
                                  <p className="text-xs font-medium uppercase text-muted-foreground">Timesheet</p>
                                  <div className="flex items-center gap-1">
                                    <Tooltip content={rowExpanded ? 'Ocultar atividade' : 'Mostrar atividade'}>
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        onClick={(event) => {
                                          event.stopPropagation()
                                          setExpandedTimesheetRows((prev) => ({ ...prev, [row.id]: !rowExpanded }))
                                        }}
                                        disabled={editDisabled}
                                      >
                                        {rowExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                      </Button>
                                    </Tooltip>
                                    <Tooltip content="Editar linha">
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        onClick={(event) => {
                                          event.stopPropagation()
                                          setEditingTimesheetItemId(row.id)
                                        }}
                                        disabled={editDisabled}
                                      >
                                        <SquarePen className="h-4 w-4" />
                                      </Button>
                                    </Tooltip>
                                    <Tooltip content="Excluir linha">
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        onClick={(event) => {
                                          event.stopPropagation()
                                          removeTimesheetRow(selectedItem.id, row.id)
                                        }}
                                        disabled={editDisabled || selectedTimesheetRows.length <= 1}
                                      >
                                        <Trash2 className="h-4 w-4" />
                                      </Button>
                                    </Tooltip>
                                  </div>
                                </div>

                                <div className="grid gap-3 md:grid-cols-3">
                                  <div className="space-y-2">
                                    <Input
                                      type="date"
                                      value={row.dataLancamento}
                                      onChange={(event) =>
                                        updateTimesheetRow(selectedItem.id, row.id, { dataLancamento: normalizeDateInput(event.target.value) })
                                      }
                                      disabled={editDisabled || !rowEditing}
                                      className="h-8"
                                    />
                                    <CommandSelect
                                      value={row.profissional}
                                      onValueChange={(value) => updateTimesheetRow(selectedItem.id, row.id, { profissional: value })}
                                      options={colaboradorOptions}
                                      placeholder="Selecione o colaborador"
                                      searchPlaceholder="Buscar colaborador..."
                                      emptyText="Nenhum colaborador encontrado."
                                      disabled={editDisabled || !rowEditing}
                                    />
                                    <CommandSelect
                                      value={row.casoId}
                                      onValueChange={(value) =>
                                        updateTimesheetRow(selectedItem.id, row.id, {
                                          casoId: value,
                                          contratoId: caseTransferMap.caseToContrato.get(value) || row.contratoId,
                                        })
                                      }
                                      options={caseTransferMap.options}
                                      placeholder="Transferir para outro caso"
                                      searchPlaceholder="Buscar caso de destino..."
                                      emptyText="Nenhum caso encontrado."
                                      disabled={editDisabled || !rowEditing}
                                    />
                                  </div>
                                  <div className="space-y-2">
                                    <div className="text-xs text-muted-foreground">Iniciais: {formatHours(parseDecimalInput(row.horasIniciais))}</div>
                                    <Input
                                      value={row.horasRevisadas}
                                      onChange={(event) => updateTimesheetRow(selectedItem.id, row.id, { horasRevisadas: event.target.value })}
                                      disabled={editDisabled || !rowEditing}
                                      className="h-8"
                                    />
                                  </div>
                                  <div className="space-y-2">
                                    <div className="text-xs text-muted-foreground">
                                      Base: {formatMoney(parseDecimalInput(row.horasIniciais) * parseDecimalInput(row.valorHoraInicial))}
                                    </div>
                                    <MoneyInput
                                      value={row.valorHora}
                                      onValueChange={(value) => updateTimesheetRow(selectedItem.id, row.id, { valorHora: value })}
                                      disabled={editDisabled || !rowEditing}
                                    />
                                  </div>
                                </div>

                                {rowExpanded ? (
                                  <div className="mt-3">
                                    <label className="mb-1 block text-xs font-medium uppercase text-gray-500">Atividade / descrição</label>
                                    <Textarea
                                      value={row.atividade}
                                      onChange={(event) => updateTimesheetRow(selectedItem.id, row.id, { atividade: event.target.value })}
                                      disabled={editDisabled || !rowEditing}
                                      rows={3}
                                      className="resize-y"
                                    />
                                  </div>
                                ) : null}
                              </li>
                            )
                          })}
                        </ul>
                      </div>
                    ))}
                  </div>

                  <div className="rounded-md border bg-muted/20 p-3 text-sm">
                    <div>
                      Horas iniciais: <strong>{formatHours(totalHorasIniciais)}</strong> • Horas revisadas:{' '}
                      <strong>{formatHours(totalHorasRevisadas)}</strong>
                    </div>
                    <div>
                      Valor inicial (base): <strong>{formatMoney(valorInicialTimesheet)}</strong>
                    </div>
                    Valor sugerido (horas x valor/hora): <strong>{formatMoney(valorSugerido)}</strong>
                  </div>
                </>
              ) : (
                <>
                  <div className="rounded-md border bg-muted/20 p-3 text-sm">
                    <strong>{getRuleTitle(selectedItem)}</strong>
                    <div className="text-muted-foreground">
                      Ajuste os itens de valor abaixo. Se houver mais de uma parcela/período no snapshot, cada linha é revisada separadamente.
                    </div>
                  </div>

                  <div className="flex items-center justify-end">
                    <Button variant="outline" onClick={() => addValueRow(selectedItem.id)} disabled={editDisabled}>
                      <Plus className="mr-2 h-4 w-4" />
                      Adicionar item
                    </Button>
                  </div>

                  <div className="rounded-md border">
                    <table className="w-full min-w-full table-fixed caption-bottom text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Referência</th>
                          <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Descrição</th>
                          <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Valor original</th>
                          <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Valor revisado</th>
                          <th className="px-3 py-2 text-right text-xs font-medium uppercase text-gray-500">Ações</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedValueRows.map((row) => {
                          const rowEditing = editingTimesheetItemId === row.id
                          return (
                            <tr key={row.id} className={rowEditing ? 'bg-primary/5' : ''}>
                              <td className="px-3 py-2 text-sm">
                                <Input
                                  value={formatDateDisplay(row.referencia)}
                                  onChange={(event) => updateValueRow(selectedItem.id, row.id, { referencia: event.target.value })}
                                  onBlur={(event) =>
                                    updateValueRow(selectedItem.id, row.id, { referencia: normalizeDateFromDisplay(event.target.value) })
                                  }
                                  placeholder="DD/MM/AAAA"
                                  disabled={editDisabled || !rowEditing}
                                  className="h-8"
                                />
                              </td>
                              <td className="px-3 py-2 text-sm">
                                <Input
                                  value={row.descricao}
                                  onChange={(event) => updateValueRow(selectedItem.id, row.id, { descricao: event.target.value })}
                                  disabled={editDisabled || !rowEditing}
                                  className="h-8"
                                />
                              </td>
                              <td className="px-3 py-2 text-sm">{formatMoney(parseDecimalInput(row.valorOriginal))}</td>
                              <td className="px-3 py-2 text-sm">
                                <MoneyInput
                                  value={row.valorRevisado}
                                  onValueChange={(value) => updateValueRow(selectedItem.id, row.id, { valorRevisado: value })}
                                  disabled={editDisabled || !rowEditing}
                                />
                              </td>
                              <td className="px-3 py-2 text-right">
                                <Tooltip content="Editar linha">
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    onClick={(event) => {
                                      event.stopPropagation()
                                      setEditingTimesheetItemId(row.id)
                                    }}
                                    disabled={editDisabled}
                                  >
                                    <SquarePen className="h-4 w-4" />
                                  </Button>
                                </Tooltip>
                                <Tooltip content="Excluir linha">
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    onClick={(event) => {
                                      event.stopPropagation()
                                      removeValueRow(selectedItem.id, row.id)
                                    }}
                                    disabled={editDisabled || selectedValueRows.length <= 1}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </Tooltip>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div className="rounded-md border bg-muted/20 p-3 text-sm">
                    Valor original: <strong>{formatMoney(valorOriginalRegras)}</strong> • Valor revisado:{' '}
                    <strong>{formatMoney(valorRevisadoRegras)}</strong>
                  </div>

                  <div className="space-y-1">
                    <label className="text-sm font-medium">Observação</label>
                    <Textarea
                      value={selectedDraft.observacao}
                      onChange={(event) => updateDraft(selectedItem.id, { observacao: event.target.value })}
                      disabled={editDisabled}
                      rows={3}
                    />
                  </div>
                </>
              )}
            </div>
          ) : null}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setSelectedClienteKey(null)
                setSelectedClienteContractTab('')
                setSelectedClienteItemTab('')
                setSelectedItemId(null)
                setSelectedReviewMode('default')
                setEditingTimesheetItemId(null)
              }}
            >
              Fechar
            </Button>
            {selectedItem ? (
              <>
                <Button
                  variant="outline"
                  onClick={() => void moveStatus(selectedItem, 'retornar')}
                  disabled={modalBusy || !canReturn(selectedItem.status)}
                >
                  <Undo2 className="mr-2 h-4 w-4" />
                  Retornar
                </Button>
                {canAdvance(selectedItem.status) ? (
                  <Button onClick={() => void saveAndAdvanceItem(selectedItem)} disabled={modalBusy}>
                    {movingItemId === selectedItem.id || savingItemId === selectedItem.id ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : null}
                    {getAdvanceActionLabel(selectedItem)}
                  </Button>
                ) : null}
              </>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!selectedItem && !selectedClienteKey}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedItemId(null)
            setSelectedReviewMode('default')
            setEditingTimesheetItemId(null)
          }
        }}
      >
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>Revisar item de faturamento</DialogTitle>
            <DialogDescription>
              {selectedItem
                ? `${selectedItem.contratoNumero ? `${selectedItem.contratoNumero} - ` : ''}${selectedItem.contratoNome}`
                : ''}
            </DialogDescription>
          </DialogHeader>

          {selectedItem && selectedDraft ? (
            <div className="space-y-4">
              {itemLocked ? (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  Item em status <strong>{formatStatus(selectedItem.status)}</strong>. Edição bloqueada.
                </div>
              ) : null}
              {isTimesheetMode ? (
                <>
                <div className="flex items-center justify-end">
                  <Button variant="outline" onClick={() => addTimesheetRow(selectedItem.id)} disabled={editDisabled}>
                    <Plus className="mr-2 h-4 w-4" />
                    Adicionar timesheet
                  </Button>
                </div>

                <div className="space-y-3">
                  {groupedTimesheetRows.map((group) => (
                    <div key={group.key} className="overflow-visible rounded-md border">
                      <div className="border-b bg-muted/20 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {group.label} • {group.rows.length} lançamento{group.rows.length > 1 ? 's' : ''}
                      </div>
                      <ul className="divide-y">
                        {group.rows.map((row) => {
                          const rowEditing = editingTimesheetItemId === row.id
                          const rowExpanded = !!expandedTimesheetRows[row.id]
                          return (
                            <li key={row.id} className={`p-3 ${rowEditing ? 'bg-primary/5' : ''}`}>
                              <div className="mb-2 flex items-center justify-between">
                                <p className="text-xs font-medium uppercase text-muted-foreground">Timesheet</p>
                                <div className="flex items-center gap-1">
                                  <Tooltip content={rowExpanded ? 'Ocultar atividade' : 'Mostrar atividade'}>
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      onClick={(event) => {
                                        event.stopPropagation()
                                        setExpandedTimesheetRows((prev) => ({ ...prev, [row.id]: !rowExpanded }))
                                      }}
                                      disabled={editDisabled}
                                    >
                                      {rowExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                    </Button>
                                  </Tooltip>
                                  <Tooltip content="Editar linha">
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      onClick={(event) => {
                                        event.stopPropagation()
                                        setEditingTimesheetItemId(row.id)
                                      }}
                                      disabled={editDisabled}
                                    >
                                      <SquarePen className="h-4 w-4" />
                                    </Button>
                                  </Tooltip>
                                  <Tooltip content="Excluir linha">
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      onClick={(event) => {
                                        event.stopPropagation()
                                        removeTimesheetRow(selectedItem.id, row.id)
                                      }}
                                      disabled={editDisabled || selectedTimesheetRows.length <= 1}
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  </Tooltip>
                                </div>
                              </div>

                              <div className="grid gap-3 md:grid-cols-3">
                                <div className="space-y-2">
                                  <Input
                                    type="date"
                                    value={row.dataLancamento}
                                    onChange={(event) =>
                                      updateTimesheetRow(selectedItem.id, row.id, { dataLancamento: normalizeDateInput(event.target.value) })
                                    }
                                    disabled={editDisabled || !rowEditing}
                                    className="h-8"
                                  />
                                  <CommandSelect
                                    value={row.profissional}
                                    onValueChange={(value) => updateTimesheetRow(selectedItem.id, row.id, { profissional: value })}
                                    options={colaboradorOptions}
                                    placeholder="Selecione o colaborador"
                                    searchPlaceholder="Buscar colaborador..."
                                    emptyText="Nenhum colaborador encontrado."
                                    disabled={editDisabled || !rowEditing}
                                  />
                                  <CommandSelect
                                    value={row.casoId}
                                    onValueChange={(value) =>
                                      updateTimesheetRow(selectedItem.id, row.id, {
                                        casoId: value,
                                        contratoId: caseTransferMap.caseToContrato.get(value) || row.contratoId,
                                      })
                                    }
                                    options={caseTransferMap.options}
                                    placeholder="Transferir para outro caso"
                                    searchPlaceholder="Buscar caso de destino..."
                                    emptyText="Nenhum caso encontrado."
                                    disabled={editDisabled || !rowEditing}
                                  />
                                </div>
                                <div className="space-y-2">
                                  <div className="text-xs text-muted-foreground">Iniciais: {formatHours(parseDecimalInput(row.horasIniciais))}</div>
                                  <Input
                                    value={row.horasRevisadas}
                                    onChange={(event) => updateTimesheetRow(selectedItem.id, row.id, { horasRevisadas: event.target.value })}
                                    disabled={editDisabled || !rowEditing}
                                    className="h-8"
                                  />
                                </div>
                                <div className="space-y-2">
                                  <div className="text-xs text-muted-foreground">
                                    Base: {formatMoney(parseDecimalInput(row.horasIniciais) * parseDecimalInput(row.valorHoraInicial))}
                                  </div>
                                  <MoneyInput
                                    value={row.valorHora}
                                    onValueChange={(value) => updateTimesheetRow(selectedItem.id, row.id, { valorHora: value })}
                                    disabled={editDisabled || !rowEditing}
                                  />
                                </div>
                              </div>

                              {rowExpanded ? (
                                <div className="mt-3">
                                  <label className="mb-1 block text-xs font-medium uppercase text-gray-500">Atividade / descrição</label>
                                  <Textarea
                                    value={row.atividade}
                                    onChange={(event) => updateTimesheetRow(selectedItem.id, row.id, { atividade: event.target.value })}
                                    disabled={editDisabled || !rowEditing}
                                    rows={3}
                                    className="resize-y"
                                  />
                                </div>
                              ) : null}
                            </li>
                          )
                        })}
                      </ul>
                    </div>
                  ))}
                </div>

                <div className="rounded-md border bg-muted/20 p-3 text-sm">
                  <div>
                    Horas iniciais: <strong>{formatHours(totalHorasIniciais)}</strong> • Horas revisadas:{' '}
                    <strong>{formatHours(totalHorasRevisadas)}</strong>
                  </div>
                  <div>
                    Valor inicial (base): <strong>{formatMoney(valorInicialTimesheet)}</strong>
                  </div>
                  Valor sugerido (horas x valor/hora): <strong>{formatMoney(valorSugerido)}</strong>
                </div>

                <p className="text-xs text-muted-foreground">
                  Use os ícones da coluna <strong>Ações</strong> para expandir a descrição e habilitar edição da linha. As{' '}
                  <strong>horas iniciais</strong> são mantidas como referência e não podem ser alteradas.
                </p>
                </>
              ) : (
                <>
                <div className="rounded-md border bg-muted/20 p-3 text-sm">
                  <strong>{getRuleTitle(selectedItem)}</strong>
                  <div className="text-muted-foreground">
                    Ajuste os itens de valor abaixo. Se houver mais de uma parcela/período no snapshot, cada linha é revisada separadamente.
                  </div>
                </div>

                <div className="flex items-center justify-end">
                  <Button variant="outline" onClick={() => addValueRow(selectedItem.id)} disabled={editDisabled}>
                    <Plus className="mr-2 h-4 w-4" />
                    Adicionar item
                  </Button>
                </div>

                <div className="rounded-md border">
                  <table className="w-full min-w-full table-fixed caption-bottom text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Referência</th>
                        <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Descrição</th>
                        <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Valor original</th>
                        <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Valor revisado</th>
                        <th className="px-3 py-2 text-right text-xs font-medium uppercase text-gray-500">Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedValueRows.map((row) => {
                        const rowEditing = editingTimesheetItemId === row.id
                        return (
                          <tr key={row.id} className={rowEditing ? 'bg-primary/5' : ''}>
                            <td className="px-3 py-2 text-sm">
                              <Input
                                value={formatDateDisplay(row.referencia)}
                                onChange={(event) => updateValueRow(selectedItem.id, row.id, { referencia: event.target.value })}
                                onBlur={(event) =>
                                  updateValueRow(selectedItem.id, row.id, { referencia: normalizeDateFromDisplay(event.target.value) })
                                }
                                placeholder="DD/MM/AAAA"
                                disabled={editDisabled || !rowEditing}
                                className="h-8"
                              />
                            </td>
                            <td className="px-3 py-2 text-sm">
                              <Input
                                value={row.descricao}
                                onChange={(event) => updateValueRow(selectedItem.id, row.id, { descricao: event.target.value })}
                                disabled={editDisabled || !rowEditing}
                                className="h-8"
                              />
                            </td>
                            <td className="px-3 py-2 text-sm">{formatMoney(parseDecimalInput(row.valorOriginal))}</td>
                            <td className="px-3 py-2 text-sm">
                              <MoneyInput
                                value={row.valorRevisado}
                                onValueChange={(value) => updateValueRow(selectedItem.id, row.id, { valorRevisado: value })}
                                disabled={editDisabled || !rowEditing}
                              />
                            </td>
                            <td className="px-3 py-2 text-right">
                              <Tooltip content="Editar linha">
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    setEditingTimesheetItemId(row.id)
                                  }}
                                  disabled={editDisabled}
                                >
                                  <SquarePen className="h-4 w-4" />
                                </Button>
                              </Tooltip>
                              <Tooltip content="Excluir linha">
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    removeValueRow(selectedItem.id, row.id)
                                  }}
                                  disabled={editDisabled || selectedValueRows.length <= 1}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </Tooltip>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="rounded-md border bg-muted/20 p-3 text-sm">
                  Valor original: <strong>{formatMoney(valorOriginalRegras)}</strong> • Valor revisado:{' '}
                  <strong>{formatMoney(valorRevisadoRegras)}</strong>
                </div>

                <div className="space-y-1">
                  <label className="text-sm font-medium">Observação</label>
                  <Textarea
                    value={selectedDraft.observacao}
                    onChange={(event) => updateDraft(selectedItem.id, { observacao: event.target.value })}
                    disabled={editDisabled}
                    rows={3}
                  />
                </div>
                </>
              )}
            </div>
          ) : null}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setSelectedItemId(null)
                setSelectedReviewMode('default')
                setEditingTimesheetItemId(null)
              }}
              disabled={modalBusy}
            >
              Fechar
            </Button>
            {selectedItem ? (
              <>
                <Button
                  variant="outline"
                  onClick={() => void moveStatus(selectedItem, 'retornar')}
                  disabled={modalBusy || !canReturn(selectedItem.status)}
                >
                  <Undo2 className="mr-2 h-4 w-4" />
                  Retornar
                </Button>
                {canAdvance(selectedItem.status) ? (
                  <Button onClick={() => void saveAndAdvanceItem(selectedItem)} disabled={modalBusy}>
                    {movingItemId === selectedItem.id || savingItemId === selectedItem.id ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : null}
                    {getAdvanceActionLabel(selectedItem)}
                  </Button>
                ) : null}
              </>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!selectedContratoConfig}
        onOpenChange={(open) => {
          if (!open && !savingContratoConfig) setSelectedContratoConfigId(null)
        }}
      >
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Revisores e aprovadores do contrato</DialogTitle>
            <DialogDescription>
              {selectedContratoConfig
                ? `${selectedContratoConfig.numero ? `${selectedContratoConfig.numero} - ` : ''}${selectedContratoConfig.nome}`
                : ''}
            </DialogDescription>
          </DialogHeader>

          {selectedContratoConfig ? (
            <div className="space-y-4">
              {selectedContratoConfig.casos.map((caso) => (
                <div key={caso.id} className="rounded-md border p-3">
                  <p className="mb-3 text-sm font-semibold">
                    {caso.numero ? `${caso.numero} - ` : ''}
                    {caso.nome}
                  </p>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-semibold uppercase text-muted-foreground">Revisores</p>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            updateCasoFluxo(caso.id, 'revisores', (entries) => [
                              ...entries,
                              { colaborador_id: '', ordem: entries.length + 1 },
                            ])
                          }
                        >
                          <Plus className="mr-1 h-4 w-4" />
                          Adicionar
                        </Button>
                      </div>
                      {(caso.timesheetConfig.revisores || []).map((entry, idx) => (
                        <div key={`rev-${caso.id}-${idx}`} className="grid grid-cols-[96px_1fr_40px] items-center gap-2">
                          <Input
                            type="number"
                            min={1}
                            value={String(entry.ordem)}
                            onChange={(event) =>
                              updateCasoFluxo(caso.id, 'revisores', (entries) =>
                                entries.map((current, currentIdx) =>
                                  currentIdx === idx ? { ...current, ordem: asNumber(event.target.value, current.ordem) } : current,
                                ),
                              )
                            }
                          />
                          <CommandSelect
                            value={entry.colaborador_id}
                            onValueChange={(value) =>
                              updateCasoFluxo(caso.id, 'revisores', (entries) =>
                                entries.map((current, currentIdx) =>
                                  currentIdx === idx ? { ...current, colaborador_id: value } : current,
                                ),
                              )
                            }
                            options={colaboradorIdOptions}
                            placeholder="Selecione o colaborador"
                            searchPlaceholder="Buscar colaborador..."
                            emptyText="Nenhum colaborador encontrado."
                          />
                          <Tooltip content="Remover revisor">
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() =>
                                updateCasoFluxo(caso.id, 'revisores', (entries) => entries.filter((_, currentIdx) => currentIdx !== idx))
                              }
                              disabled={(caso.timesheetConfig.revisores || []).length <= 1}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </Tooltip>
                        </div>
                      ))}
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-semibold uppercase text-muted-foreground">Aprovadores</p>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            updateCasoFluxo(caso.id, 'aprovadores', (entries) => [
                              ...entries,
                              { colaborador_id: '', ordem: entries.length + 1 },
                            ])
                          }
                        >
                          <Plus className="mr-1 h-4 w-4" />
                          Adicionar
                        </Button>
                      </div>
                      {(caso.timesheetConfig.aprovadores || []).map((entry, idx) => (
                        <div key={`apr-${caso.id}-${idx}`} className="grid grid-cols-[96px_1fr_40px] items-center gap-2">
                          <Input
                            type="number"
                            min={1}
                            value={String(entry.ordem)}
                            onChange={(event) =>
                              updateCasoFluxo(caso.id, 'aprovadores', (entries) =>
                                entries.map((current, currentIdx) =>
                                  currentIdx === idx ? { ...current, ordem: asNumber(event.target.value, current.ordem) } : current,
                                ),
                              )
                            }
                          />
                          <CommandSelect
                            value={entry.colaborador_id}
                            onValueChange={(value) =>
                              updateCasoFluxo(caso.id, 'aprovadores', (entries) =>
                                entries.map((current, currentIdx) =>
                                  currentIdx === idx ? { ...current, colaborador_id: value } : current,
                                ),
                              )
                            }
                            options={colaboradorIdOptions}
                            placeholder="Selecione o colaborador"
                            searchPlaceholder="Buscar colaborador..."
                            emptyText="Nenhum colaborador encontrado."
                          />
                          <Tooltip content="Remover aprovador">
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() =>
                                updateCasoFluxo(caso.id, 'aprovadores', (entries) => entries.filter((_, currentIdx) => currentIdx !== idx))
                              }
                              disabled={(caso.timesheetConfig.aprovadores || []).length <= 1}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </Tooltip>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedContratoConfigId(null)} disabled={savingContratoConfig}>
              Fechar
            </Button>
            <Button onClick={() => void saveContratoConfig()} disabled={savingContratoConfig}>
              {savingContratoConfig ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Salvar responsáveis
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
