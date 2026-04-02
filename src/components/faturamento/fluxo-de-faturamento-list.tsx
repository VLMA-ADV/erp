'use client'

import { Fragment, useEffect, useMemo, useState } from 'react'
import {
  ArrowRightLeft,
  ChevronDown,
  ChevronRight,
  DollarSign,
  Eye,
  Loader2,
  Send,
  Undo2,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { CommandSelect, type CommandSelectOption } from '@/components/ui/command-select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { NativeSelect } from '@/components/ui/native-select'
import { Table } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useToast } from '@/components/ui/toast'

interface RevisaoItem {
  id: string
  contrato_id: string
  caso_id: string
  cliente_nome?: string | null
  contrato_numero: number | null
  contrato_nome: string
  caso_numero?: number | null
  caso_nome?: string | null
  origem_tipo: string
  data_referencia?: string | null
  regra_nome?: string | null
  status: 'em_revisao' | 'em_aprovacao' | 'aprovado' | 'faturado' | 'cancelado' | 'disponivel'
  responsavel_fluxo_nome?: string | null
  responsavel_revisao_nome?: string | null
  responsavel_aprovacao_nome?: string | null
  snapshot?: Record<string, unknown> | null
  horas_revisadas: number | null
  horas_aprovadas?: number | null
  horas_informadas: number | null
  valor_revisado: number | null
  valor_aprovado?: number | null
  valor_informado: number | null
}

interface CasoGroupFluxo {
  key: string
  casoId: string
  numero: number | null
  nome: string
  totalHoras: number
  totalValor: number
  itemCount: number
  itens: RevisaoItem[]
}

interface ContratoGroupFluxo {
  key: string
  contratoId: string
  numero: number | null
  nome: string
  totalHoras: number
  totalValor: number
  itemCount: number
  casos: CasoGroupFluxo[]
}

interface ClienteGroupFluxo {
  key: string
  nome: string
  totalHoras: number
  totalValor: number
  itemCount: number
  contratos: ContratoGroupFluxo[]
}

interface ResumoCasoDialogRow {
  key: string
  contrato: string
  caso: string
  data: string
  profissional: string
  atividade: string
  revisor: string
  aprovador: string
  horasInformadas: number | null
  horasRevisadas: number | null
  valorFinal: number | null
}

function toObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function getSnapshotTimesheetTotals(item: RevisaoItem) {
  const snapshot = item.snapshot || {}
  const rawRows = Array.isArray(snapshot.timesheet_itens_revisao) ? (snapshot.timesheet_itens_revisao as unknown[]) : []
  if (rawRows.length === 0) return null

  let hours = 0
  let value = 0
  for (const raw of rawRows) {
    const row = toObject(raw)
    if (!row) continue
    const rowHours = Number(row.horas_revisadas ?? row.horas ?? row.horas_iniciais ?? 0)
    const rowValorHora = Number(row.valor_hora ?? 0)
    const safeHours = Number.isFinite(rowHours) ? rowHours : 0
    const safeValorHora = Number.isFinite(rowValorHora) ? rowValorHora : 0
    hours += safeHours
    value += safeHours * safeValorHora
  }

  return {
    hours,
    value,
    count: rawRows.length,
  }
}

function getAprovadorOrdemAtual(item: RevisaoItem) {
  const raw = Number(item.snapshot?.aprovador_ordem_atual ?? 0)
  return Number.isFinite(raw) ? raw : 0
}

function shouldUseApprovedStageValues(item: RevisaoItem) {
  if (item.status === 'aprovado' || item.status === 'faturado' || item.status === 'cancelado') return true
  if (item.status !== 'em_aprovacao') return false
  return getAprovadorOrdemAtual(item) > 1
}

function getEffectiveHours(item: RevisaoItem) {
  if (shouldUseApprovedStageValues(item) && item.horas_aprovadas !== null && item.horas_aprovadas !== undefined) {
    return Number(item.horas_aprovadas)
  }
  if (item.horas_revisadas !== null && item.horas_revisadas !== undefined) return Number(item.horas_revisadas)
  if (item.horas_informadas !== null && item.horas_informadas !== undefined) return Number(item.horas_informadas)
  return 0
}

function getEffectiveValue(item: RevisaoItem) {
  if (shouldUseApprovedStageValues(item) && item.valor_aprovado !== null && item.valor_aprovado !== undefined) {
    return Number(item.valor_aprovado)
  }
  if (item.valor_revisado !== null && item.valor_revisado !== undefined) return Number(item.valor_revisado)
  if (item.valor_informado !== null && item.valor_informado !== undefined) return Number(item.valor_informado)
  return 0
}

function getCasoDisplayMetrics(casoItens: RevisaoItem[]) {
  const timesheetItems = casoItens.filter((entry) => entry.origem_tipo === 'timesheet')
  const nonTimesheetItems = casoItens.filter((entry) => entry.origem_tipo !== 'timesheet')
  const snapshotCarrier =
    casoItens.find((entry) => {
      const raw = Array.isArray(entry.snapshot?.timesheet_itens_revisao)
        ? (entry.snapshot?.timesheet_itens_revisao as unknown[])
        : []
      return raw.length > 0
    }) || null

  const snapshotTotals = snapshotCarrier ? getSnapshotTimesheetTotals(snapshotCarrier) : null
  const fallbackTimesheetHours = timesheetItems.reduce((acc, item) => acc + getEffectiveHours(item), 0)
  const fallbackTimesheetValue = timesheetItems.reduce((acc, item) => acc + getEffectiveValue(item), 0)
  const timesheetHours = snapshotTotals ? snapshotTotals.hours : fallbackTimesheetHours
  const timesheetValue = snapshotTotals ? snapshotTotals.value : fallbackTimesheetValue
  const timesheetItemCount = snapshotTotals?.count ?? timesheetItems.length

  const nonTimesheetHours = nonTimesheetItems.reduce((acc, item) => acc + getEffectiveHours(item), 0)
  const nonTimesheetValue = nonTimesheetItems.reduce((acc, item) => acc + getEffectiveValue(item), 0)
  const hasTimesheetLine = Boolean(snapshotCarrier || timesheetItems.length > 0 || casoItens.length > 0)

  return {
    totalHoras: nonTimesheetHours + (hasTimesheetLine ? timesheetHours : 0),
    totalValor: nonTimesheetValue + (hasTimesheetLine ? timesheetValue : 0),
    itemCount: nonTimesheetItems.length + (hasTimesheetLine ? 1 : 0),
  }
}

interface FluxoItemDetalhe {
  id: string
  contratoId: string
  casoId: string | null
  descricao: string
  referencia: string
  horas: number
  valor: number
  status: RevisaoItem['status']
  statusLabel: string
  responsavelAtual: string
}

function formatMoney(value: number | string | null | undefined) {
  const amount = Number(value || 0)
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(amount)
}

function formatHours(value: number | string | null | undefined) {
  const amount = Number(value || 0)
  return amount.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatStatus(value: string) {
  switch (value) {
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
      return value || '-'
  }
}

function getDetalheRowClass(status: RevisaoItem['status']) {
  if (status === 'em_revisao') return 'bg-yellow-50'
  if (status === 'aprovado') return 'bg-green-50'
  return ''
}

function isDetalheFaturavel(detalhe: FluxoItemDetalhe) {
  return detalhe.status === 'aprovado'
}

function asText(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function getRuleKind(item: RevisaoItem) {
  return asText(item.snapshot?.regra_cobranca || '').trim().toLowerCase()
}

function getRuleTitle(item: RevisaoItem) {
  if (item.origem_tipo === 'timesheet') return 'Timesheet'
  if (item.origem_tipo === 'despesa') return 'Despesa'
  const kind = getRuleKind(item)
  if (kind === 'mensalidade_processo') return 'Mensalidade de processo'
  if (kind === 'mensal') return 'Mensalidade'
  if (kind === 'projeto') return 'Projeto'
  if (kind === 'projeto_parcelado') return 'Projeto parcelado'
  if (kind === 'exito') return 'Êxito'
  if (kind === 'hora') return 'Hora'
  return asText(item.regra_nome).trim() || 'Regra financeira'
}

function getRuleType(item: RevisaoItem) {
  if (item.origem_tipo === 'timesheet') return 'hora'
  if (item.origem_tipo === 'despesa') return 'despesa'
  const kind = getRuleKind(item)
  if (kind === 'mensalidade_processo') return 'mensalidade_processo'
  if (kind === 'mensal') return 'mensalidade'
  if (kind === 'projeto') return 'projeto'
  if (kind === 'projeto_parcelado') return 'projeto_parcelado'
  if (kind === 'exito') return 'exito'
  if (kind === 'hora') return 'hora'
  return 'outros'
}

function resolveResponsavelAtual(item: RevisaoItem) {
  const snapshot = item.snapshot || {}
  const snapshotRevisor = typeof snapshot.responsavel_revisao_nome === 'string' ? snapshot.responsavel_revisao_nome : null
  const snapshotAprovador = typeof snapshot.responsavel_aprovacao_nome === 'string' ? snapshot.responsavel_aprovacao_nome : null
  const snapshotFluxo = typeof snapshot.responsavel_fluxo_nome === 'string' ? snapshot.responsavel_fluxo_nome : null

  if (item.status === 'em_revisao') {
    return item.responsavel_fluxo_nome || item.responsavel_revisao_nome || snapshotFluxo || snapshotRevisor || '-'
  }
  if (item.status === 'em_aprovacao') {
    return item.responsavel_fluxo_nome || item.responsavel_aprovacao_nome || snapshotFluxo || snapshotAprovador || '-'
  }
  return '-'
}

function getItemMetrics(item: RevisaoItem) {
  if (item.origem_tipo === 'timesheet') {
    const snapshotTotals = getSnapshotTimesheetTotals(item)
    if (snapshotTotals) {
      return { horas: snapshotTotals.hours, valor: snapshotTotals.value, itens: 1 }
    }
  }

  return {
    horas: getEffectiveHours(item),
    valor: getEffectiveValue(item),
    itens: 1,
  }
}

function summarizeStatusAndResponsavel(groupItems: RevisaoItem[]) {
  const statusSet = new Set<string>()
  const responsavelSet = new Set<string>()
  for (const item of groupItems) {
    statusSet.add(formatStatus(item.status))
    const responsavel = resolveResponsavelAtual(item)
    if (responsavel && responsavel !== '-') responsavelSet.add(responsavel)
  }
  return {
    status: statusSet.size === 0 ? '-' : statusSet.size === 1 ? Array.from(statusSet)[0]! : 'Múltiplos',
    responsavel:
      responsavelSet.size === 0 ? '-' : responsavelSet.size === 1 ? Array.from(responsavelSet)[0]! : 'Múltiplos',
  }
}

function buildTreeFluxo(items: RevisaoItem[]): ClienteGroupFluxo[] {
  const clientes = new Map<string, ClienteGroupFluxo>()

  for (const item of items) {
    const contratoId = item.contrato_id
    if (!contratoId) continue

    const clienteNome = asText(item.cliente_nome).trim() || 'Cliente sem nome'
    const clienteKey = clienteNome

    if (!clientes.has(clienteKey)) {
      clientes.set(clienteKey, {
        key: clienteKey,
        nome: clienteNome,
        totalHoras: 0,
        totalValor: 0,
        itemCount: 0,
        contratos: [],
      })
    }

    const cliente = clientes.get(clienteKey)!

    const contratoKey = `${clienteKey}::${item.contrato_numero ?? 'sem-numero'}-${item.contrato_nome || 'contrato'}`
    let contrato = cliente.contratos.find((entry) => entry.key === contratoKey)
    if (!contrato) {
      contrato = {
        key: contratoKey,
        contratoId,
        nome: item.contrato_nome || 'Contrato sem nome',
        numero: item.contrato_numero ?? null,
        totalHoras: 0,
        totalValor: 0,
        itemCount: 0,
        casos: [],
      }
      cliente.contratos.push(contrato)
    }

    const casoId = item.caso_id || 'sem-caso'
    const casoNome = asText(item.caso_nome).trim() || 'Caso sem nome'
    const casoNumero = Number(item.caso_numero ?? 0) || null
    const casoKey = `${contratoKey}::${casoId}-${casoNome}`

    let caso = contrato.casos.find((entry) => entry.key === casoKey)
    if (!caso) {
      caso = {
        key: casoKey,
        casoId: item.caso_id || '',
        nome: casoNome,
        numero: casoNumero,
        totalHoras: 0,
        totalValor: 0,
        itemCount: 0,
        itens: [],
      }
      contrato.casos.push(caso)
    }

    caso.itens.push(item)
  }

  for (const cliente of clientes.values()) {
    cliente.totalHoras = 0
    cliente.totalValor = 0
    cliente.itemCount = 0
    for (const contrato of cliente.contratos) {
      contrato.totalHoras = 0
      contrato.totalValor = 0
      contrato.itemCount = 0
      for (const caso of contrato.casos) {
        const m = getCasoDisplayMetrics(caso.itens)
        caso.totalHoras = m.totalHoras
        caso.totalValor = m.totalValor
        caso.itemCount = m.itemCount
        contrato.totalHoras += m.totalHoras
        contrato.totalValor += m.totalValor
        contrato.itemCount += m.itemCount
      }
      cliente.totalHoras += contrato.totalHoras
      cliente.totalValor += contrato.totalValor
      cliente.itemCount += contrato.itemCount
    }
  }

  for (const cliente of clientes.values()) {
    cliente.contratos.sort((a, b) => {
      const n = (a.numero ?? 0) - (b.numero ?? 0)
      if (n !== 0) return n
      return a.nome.localeCompare(b.nome, 'pt-BR')
    })
    for (const contrato of cliente.contratos) {
      contrato.casos.sort((a, b) => {
        const n = (a.numero ?? 0) - (b.numero ?? 0)
        if (n !== 0) return n
        return a.nome.localeCompare(b.nome, 'pt-BR')
      })
    }
  }

  return Array.from(clientes.values()).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
}

function itemToDetalhe(item: RevisaoItem): FluxoItemDetalhe {
  const metrics = getItemMetrics(item)
  const contratoId = item.contrato_id
  return {
    id: item.id,
    contratoId,
    casoId: item.caso_id || null,
    descricao: item.origem_tipo === 'timesheet' ? 'Timesheet' : getRuleTitle(item),
    referencia: asText(item.data_referencia),
    horas: metrics.horas,
    valor: metrics.valor,
    status: item.status,
    statusLabel: formatStatus(item.status),
    responsavelAtual: resolveResponsavelAtual(item),
  }
}

function parseTimesheetRowsForDialog(item: RevisaoItem) {
  const raw = Array.isArray(item.snapshot?.timesheet_itens_revisao)
    ? (item.snapshot?.timesheet_itens_revisao as unknown[])
    : []
  return raw
    .map((entry) => {
      const row = toObject(entry)
      if (!row) return null
      return {
        data: asText(row.data_lancamento),
        profissional: asText(row.profissional),
        atividade: asText(row.atividade ?? row.descricao),
        horasInformadas: Number(row.horas_iniciais ?? row.horas_informadas ?? row.horas ?? 0),
        horasRevisadas: Number(row.horas_revisadas ?? row.horas ?? 0),
        valorHora: Number(row.valor_hora ?? 0),
      }
    })
    .filter((row): row is NonNullable<typeof row> => row !== null)
}

function formatDateCell(value: string | null | undefined) {
  if (!value) return '—'
  const normalized = `${value}T00:00:00`
  const dt = new Date(normalized)
  if (Number.isNaN(dt.getTime())) return value
  return dt.toLocaleDateString('pt-BR')
}

function buildResumoCasoDialogRows(resumoCasoGroup: {
  contrato: ContratoGroupFluxo
  caso: CasoGroupFluxo
}): ResumoCasoDialogRow[] {
  const contratoLabel = resumoCasoGroup.contrato.numero
    ? `${resumoCasoGroup.contrato.numero} - ${resumoCasoGroup.contrato.nome}`
    : resumoCasoGroup.contrato.nome
  const casoLabel = resumoCasoGroup.caso.numero
    ? `${resumoCasoGroup.caso.numero} - ${resumoCasoGroup.caso.nome}`
    : resumoCasoGroup.caso.nome

  return resumoCasoGroup.caso.itens.flatMap((itemRow) => {
    const snapshot = itemRow.snapshot || {}
    const revisor =
      itemRow.responsavel_revisao_nome ||
      (typeof snapshot.responsavel_revisao_nome === 'string' ? snapshot.responsavel_revisao_nome : null) ||
      '-'
    const aprovador =
      itemRow.responsavel_aprovacao_nome ||
      (typeof snapshot.responsavel_aprovacao_nome === 'string' ? snapshot.responsavel_aprovacao_nome : null) ||
      '-'
    const snapRows = itemRow.origem_tipo === 'timesheet' ? parseTimesheetRowsForDialog(itemRow) : []

    if (snapRows.length > 0) {
      return snapRows.map((row, idx) => ({
        key: `${itemRow.id}-${idx}`,
        contrato: contratoLabel,
        caso: casoLabel,
        data: formatDateCell(row.data || itemRow.data_referencia || null),
        profissional: row.profissional || '-',
        atividade: row.atividade || '—',
        revisor,
        aprovador,
        horasInformadas: Number.isFinite(row.horasInformadas) ? row.horasInformadas : null,
        horasRevisadas: Number.isFinite(row.horasRevisadas) ? row.horasRevisadas : null,
        valorFinal:
          Number.isFinite(row.horasRevisadas) && Number.isFinite(row.valorHora)
            ? row.horasRevisadas * row.valorHora
            : null,
      }))
    }

    return [
      {
        key: itemRow.id,
        contrato: contratoLabel,
        caso: casoLabel,
        data: formatDateCell(itemRow.data_referencia || null),
        profissional: '-',
        atividade: itemRow.origem_tipo === 'despesa' ? 'Despesa' : getRuleTitle(itemRow),
        revisor,
        aprovador,
        horasInformadas: itemRow.horas_informadas,
        horasRevisadas: itemRow.horas_revisadas,
        valorFinal: getEffectiveValue(itemRow),
      },
    ]
  })
}

export default function FluxoDeFaturamentoList() {
  const { success, error: toastError } = useToast()
  const [loading, setLoading] = useState(true)
  const [loadingContratos, setLoadingContratos] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [rawItems, setRawItems] = useState<RevisaoItem[]>([])
  const [status, setStatus] = useState('')
  const [caso, setCaso] = useState('')
  const [regraTipoTab, setRegraTipoTab] = useState('all')
  const [casoOptions, setCasoOptions] = useState<CommandSelectOption[]>([])
  const [expandedClientes, setExpandedClientes] = useState<Record<string, boolean>>({})
  const [expandedContratos, setExpandedContratos] = useState<Record<string, boolean>>({})
  const [expandedCasos, setExpandedCasos] = useState<Record<string, boolean>>({})
  const [selectedFaturamentoItems, setSelectedFaturamentoItems] = useState<Record<string, boolean>>({})
  const [faturandoSelecionados, setFaturandoSelecionados] = useState(false)
  const [faturandoItemId, setFaturandoItemId] = useState<string | null>(null)

  const [resumoCasoKey, setResumoCasoKey] = useState<string | null>(null)
  const [devolvendo, setDevolvendo] = useState(false)

  const [transferItemId, setTransferItemId] = useState<string | null>(null)
  const [transferCasoId, setTransferCasoId] = useState('')
  const [transferring, setTransferring] = useState(false)

  const loadContratosEmRevisao = async () => {
    try {
      setLoading(true)
      setLoadingContratos(true)
      setError(null)
      const supabase = createClient()
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session) return
      const params = new URLSearchParams()
      if (status) params.set('status', status)
      if (caso) params.set('caso', caso)
      const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-revisao-fatura?${params.toString()}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
      })

      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(payload.error || 'Erro ao carregar fluxo de faturamento')
        return
      }

      const itens = (payload.data || []) as RevisaoItem[]
      const nextCaseOptionsMap = new Map<string, CommandSelectOption>()

      for (const item of itens) {
        const casoNumero = Number(item.caso_numero ?? 0) || null
        const casoNome = asText(item.caso_nome).trim() || 'Caso sem nome'
        const caseFilterLabel = `${casoNumero ? `${casoNumero} - ` : ''}${casoNome}`
        if (caseFilterLabel) {
          nextCaseOptionsMap.set(caseFilterLabel, {
            value: caseFilterLabel,
            label: caseFilterLabel,
          })
        }
      }

      setRawItems(itens)
      setCasoOptions(
        Array.from(nextCaseOptionsMap.values()).sort((a, b) => a.label.localeCompare(b.label, 'pt-BR')),
      )
    } catch (err) {
      console.error(err)
      setError('Erro ao carregar fluxo de faturamento')
    } finally {
      setLoading(false)
      setLoadingContratos(false)
    }
  }

  useEffect(() => {
    void loadContratosEmRevisao()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, caso])

  const itensPorRegra = useMemo(() => {
    if (regraTipoTab === 'all') return rawItems
    return rawItems.filter((item) => getRuleType(item) === regraTipoTab)
  }, [rawItems, regraTipoTab])

  const tree = useMemo(() => buildTreeFluxo(itensPorRegra), [itensPorRegra])

  const flatDetalhes = useMemo(() => itensPorRegra.map(itemToDetalhe), [itensPorRegra])

  const detalhePorId = useMemo(() => new Map(flatDetalhes.map((detalhe) => [detalhe.id, detalhe])), [flatDetalhes])

  const faturamentoEligibleIds = useMemo(
    () => flatDetalhes.filter((detalhe) => isDetalheFaturavel(detalhe)).map((detalhe) => detalhe.id),
    [flatDetalhes],
  )

  const selectedFaturamentoItemIds = useMemo(
    () => faturamentoEligibleIds.filter((itemId) => !!selectedFaturamentoItems[itemId]),
    [faturamentoEligibleIds, selectedFaturamentoItems],
  )

  useEffect(() => {
    setExpandedClientes((previous) => {
      const next: Record<string, boolean> = {}
      for (const cliente of tree) {
        next[cliente.key] = previous[cliente.key] ?? true
      }
      return next
    })
    setExpandedContratos((previous) => {
      const next: Record<string, boolean> = {}
      for (const cliente of tree) {
        for (const contrato of cliente.contratos) {
          next[contrato.key] = previous[contrato.key] ?? true
        }
      }
      return next
    })
    setExpandedCasos((previous) => {
      const next: Record<string, boolean> = {}
      for (const cliente of tree) {
        for (const contrato of cliente.contratos) {
          for (const casoG of contrato.casos) {
            next[casoG.key] = previous[casoG.key] ?? true
          }
        }
      }
      return next
    })
    setSelectedFaturamentoItems((previous) => {
      const validIds = new Set(flatDetalhes.map((detalhe) => detalhe.id))
      const next: Record<string, boolean> = {}
      for (const [itemId, checked] of Object.entries(previous)) {
        if (checked && validIds.has(itemId)) next[itemId] = true
      }
      return next
    })
  }, [tree, flatDetalhes])

  const totals = useMemo(() => {
    return itensPorRegra.reduce(
      (acc, item) => {
        const m = getItemMetrics(item)
        acc.valor += m.valor
        acc.horas += m.horas
        acc.itens += m.itens
        return acc
      },
      { valor: 0, horas: 0, itens: 0 },
    )
  }, [itensPorRegra])

  const transferCasoOptions = useMemo<CommandSelectOption[]>(() => {
    const seen = new Set<string>()
    const options: CommandSelectOption[] = []
    for (const item of rawItems) {
      if (!item.caso_id || seen.has(item.caso_id)) continue
      seen.add(item.caso_id)
      const casoNum = Number(item.caso_numero ?? 0) || null
      const label = casoNum ? `${casoNum} - ${asText(item.caso_nome)}` : asText(item.caso_nome) || item.caso_id
      options.push({
        value: item.caso_id,
        label,
        group: asText(item.cliente_nome).trim() || 'Cliente sem nome',
      })
    }
    return options
  }, [rawItems])

  const resumoCasoGroup = useMemo(() => {
    if (!resumoCasoKey) return null
    for (const cliente of tree) {
      for (const contrato of cliente.contratos) {
        const casoG = contrato.casos.find((c) => c.key === resumoCasoKey)
        if (casoG) return { cliente, contrato, caso: casoG }
      }
    }
    return null
  }, [tree, resumoCasoKey])

  const toggleSelectionForItemIds = (itemIds: string[], checked: boolean) => {
    if (itemIds.length === 0) return
    setSelectedFaturamentoItems((previous) => {
      const next = { ...previous }
      for (const itemId of itemIds) {
        if (checked) next[itemId] = true
        else delete next[itemId]
      }
      return next
    })
  }

  const collectEligibleIdsUnderCaso = (casoG: CasoGroupFluxo) =>
    casoG.itens
      .map(itemToDetalhe)
      .filter((detalhe) => isDetalheFaturavel(detalhe))
      .map((d) => d.id)

  const collectEligibleIdsUnderContrato = (contrato: ContratoGroupFluxo) =>
    contrato.casos.flatMap((c) => collectEligibleIdsUnderCaso(c))

  const collectEligibleIdsUnderCliente = (cliente: ClienteGroupFluxo) =>
    cliente.contratos.flatMap((c) => collectEligibleIdsUnderContrato(c))

  const faturarItemIds = async (itemIds: string[]) => {
    if (itemIds.length === 0) {
      toastError('Selecione ao menos um item aprovado para faturar.')
      return
    }

    const selectedRows = itemIds
      .map((itemId) => detalhePorId.get(itemId))
      .filter((detalhe): detalhe is FluxoItemDetalhe => !!detalhe && isDetalheFaturavel(detalhe))

    if (selectedRows.length === 0) {
      toastError('Nenhuma linha selecionada está apta para faturamento.')
      return
    }

    const groupsByCaso = new Map<string, FluxoItemDetalhe[]>()
    for (const detalhe of selectedRows) {
      const caseKey = detalhe.casoId || `sem-caso-${detalhe.id}`
      const current = groupsByCaso.get(caseKey) || []
      current.push(detalhe)
      groupsByCaso.set(caseKey, current)
    }

    try {
      setFaturandoSelecionados(true)
      const supabase = createClient()
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session) return

      let billedItems = 0
      let billedCases = 0
      const errors: string[] = []

      for (const [, groupItems] of groupsByCaso) {
        let groupSucceeded = 0
        for (const detalhe of groupItems) {
          const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/faturar-revisao-item`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${session.access_token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              billing_item_id: detalhe.id,
              desconto_valor: 0,
              rateio_pagadores: [],
            }),
          })

          const payload = await response.json().catch(() => ({}))
          if (!response.ok) {
            errors.push(payload.error || `Erro ao faturar item ${detalhe.descricao}`)
            continue
          }
          billedItems += 1
          groupSucceeded += 1
        }
        if (groupSucceeded > 0) billedCases += 1
      }

      if (billedItems > 0) {
        success(`Faturamento concluído: ${billedItems} item(ns) em ${billedCases} caso(s).`)
      }
      if (errors.length > 0) {
        toastError(errors[0] || 'Houve erro ao faturar alguns itens.')
      }

      setSelectedFaturamentoItems({})
      await loadContratosEmRevisao()
    } catch (err) {
      console.error(err)
      toastError('Erro ao faturar itens selecionados.')
    } finally {
      setFaturandoSelecionados(false)
      setFaturandoItemId(null)
    }
  }

  const faturarSingleItem = async (itemId: string) => {
    setFaturandoItemId(itemId)
    await faturarItemIds([itemId])
  }

  const handleTransferCaso = async () => {
    if (!transferItemId || !transferCasoId) return
    setTransferring(true)
    try {
      const supabase = createClient()
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session) return

      const resp = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/update-faturamento-item`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id: transferItemId,
          caso_id: transferCasoId,
        }),
      })
      const data = await resp.json()
      if (!resp.ok) {
        toastError(data.error || 'Erro ao transferir caso')
        return
      }
      success('Caso transferido com sucesso')
      setTransferItemId(null)
      setTransferCasoId('')
      await loadContratosEmRevisao()
    } catch (e) {
      console.error(e)
      toastError('Erro ao transferir caso')
    } finally {
      setTransferring(false)
    }
  }

  const devolverCasoParaRevisao = async () => {
    if (!resumoCasoGroup) return
    const { caso: casoG } = resumoCasoGroup
    const alvos = casoG.itens.filter((it) => it.status === 'em_aprovacao' || it.status === 'aprovado')
    if (alvos.length === 0) {
      toastError('Não há itens para devolver a partir deste caso.')
      return
    }

    setDevolvendo(true)
    try {
      const supabase = createClient()
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session) return

      for (const alvo of alvos) {
        const steps = alvo.status === 'aprovado' ? 2 : 1
        for (let i = 0; i < steps; i++) {
          const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/set-revisao-fatura-status`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${session.access_token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              billing_item_id: alvo.id,
              action: 'retornar',
            }),
          })
          const payload = await response.json().catch(() => ({}))
          if (!response.ok) {
            toastError(payload.error || 'Erro ao devolver item para revisão')
            return
          }
        }
      }

      success('Itens devolvidos para revisão.')
      setResumoCasoKey(null)
      await loadContratosEmRevisao()
    } catch (err) {
      console.error(err)
      toastError('Erro ao devolver para revisão')
    } finally {
      setDevolvendo(false)
    }
  }

  const grupoRuleCount = useMemo(() => {
    let n = 0
    for (const cliente of tree) {
      for (const contrato of cliente.contratos) {
        n += contrato.casos.length
      }
    }
    return n
  }, [tree])

  return (
    <div className="space-y-4">
      {error ? (
        <Alert className="border-red-200 bg-red-50 text-red-700">
          <AlertTitle>Atenção</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-3 md:grid-cols-4">
        <div className="space-y-1">
          <label className="text-sm font-medium">Status</label>
          <NativeSelect value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">Todos os status</option>
            <option value="em_revisao">Em revisão</option>
            <option value="em_aprovacao">Em aprovação</option>
            <option value="aprovado">Aprovado</option>
            <option value="faturado">Faturado</option>
            <option value="cancelado">Cancelado</option>
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium">Caso</label>
          <CommandSelect
            value={caso}
            onValueChange={(value) => setCaso(value)}
            options={casoOptions}
            placeholder="Todos os casos"
            searchPlaceholder="Buscar caso..."
            emptyText="Nenhum caso disponível"
          />
        </div>
        <div className="md:col-span-2 flex items-end justify-end">
          <Button
            onClick={() => {
              void loadContratosEmRevisao()
            }}
            disabled={loading || loadingContratos}
          >
            {loading ? 'Atualizando...' : 'Atualizar lista'}
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between rounded-md border bg-muted/30 p-3">
        <div className="text-sm text-muted-foreground">
          <span className="mr-4">
            Casos (aba): <strong className="text-foreground">{grupoRuleCount}</strong>
          </span>
          <span className="mr-4">
            Itens: <strong className="text-foreground">{totals.itens}</strong>
          </span>
          <span>
            Horas: <strong className="text-foreground">{formatHours(totals.horas)}</strong>
          </span>
        </div>
        <div className="text-sm font-semibold">{formatMoney(totals.valor)}</div>
      </div>

      <div className="flex justify-end">
        <Button
          variant="outline"
          onClick={() => void faturarItemIds(selectedFaturamentoItemIds)}
          disabled={loading || loadingContratos || faturandoSelecionados || selectedFaturamentoItemIds.length === 0}
        >
          {faturandoSelecionados ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
          Faturar selecionados ({selectedFaturamentoItemIds.length})
        </Button>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold uppercase text-muted-foreground">Fluxo por cliente → contrato → caso</h3>
        <Tabs value={regraTipoTab} defaultValue="all" onValueChange={setRegraTipoTab}>
          <TabsList className="w-full justify-start overflow-x-auto">
            <TabsTrigger value="all">Todas</TabsTrigger>
            <TabsTrigger value="hora">Hora</TabsTrigger>
            <TabsTrigger value="mensalidade_processo">Mensalidade de processo</TabsTrigger>
            <TabsTrigger value="mensalidade">Mensalidade</TabsTrigger>
            <TabsTrigger value="projeto">Projeto</TabsTrigger>
            <TabsTrigger value="projeto_parcelado">Projeto parcelado</TabsTrigger>
            <TabsTrigger value="exito">Êxito</TabsTrigger>
            <TabsTrigger value="despesa">Despesas</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="overflow-hidden rounded-md border bg-white">
          <Table className="w-full min-w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="w-10 px-2 py-3 text-left">
                  <input
                    type="checkbox"
                    checked={
                      faturamentoEligibleIds.length > 0 &&
                      selectedFaturamentoItemIds.length === faturamentoEligibleIds.length
                    }
                    ref={(element) => {
                      if (element) {
                        element.indeterminate =
                          selectedFaturamentoItemIds.length > 0 &&
                          selectedFaturamentoItemIds.length < faturamentoEligibleIds.length
                      }
                    }}
                    onChange={(event) => toggleSelectionForItemIds(faturamentoEligibleIds, event.target.checked)}
                    disabled={faturamentoEligibleIds.length === 0 || loading || loadingContratos || faturandoSelecionados}
                  />
                </th>
                <th className="w-10 px-2 py-3" />
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Cliente / Contrato / Caso</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Responsável atual</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Itens</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Horas</th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase text-gray-500">Valor</th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase text-gray-500">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loadingContratos ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    Carregando fluxo de faturamento...
                  </td>
                </tr>
              ) : tree.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    Nenhum item no fluxo para os filtros informados.
                  </td>
                </tr>
              ) : (
                tree.map((cliente, clienteIndex) => {
                  const clienteExpanded = expandedClientes[cliente.key] ?? true
                  const clienteItems = cliente.contratos.flatMap((co) => co.casos.flatMap((ca) => ca.itens))
                  const clienteSummary = summarizeStatusAndResponsavel(clienteItems)
                  const eligibleCliente = collectEligibleIdsUnderCliente(cliente)
                  const selectedCliente = eligibleCliente.filter((id) => !!selectedFaturamentoItems[id]).length

                  return (
                    <Fragment key={cliente.key}>
                      <tr className="bg-muted/10">
                        <td className="px-2 py-3">
                          <input
                            type="checkbox"
                            checked={eligibleCliente.length > 0 && selectedCliente === eligibleCliente.length}
                            ref={(element) => {
                              if (element) {
                                element.indeterminate =
                                  selectedCliente > 0 && selectedCliente < eligibleCliente.length
                              }
                            }}
                            onChange={(event) => toggleSelectionForItemIds(eligibleCliente, event.target.checked)}
                            disabled={
                              eligibleCliente.length === 0 || loading || loadingContratos || faturandoSelecionados
                            }
                          />
                        </td>
                        <td className="px-2 py-3">
                          <button
                            type="button"
                            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-muted-foreground hover:border-border hover:bg-muted"
                            onClick={() =>
                              setExpandedClientes((p) => ({ ...p, [cliente.key]: !clienteExpanded }))
                            }
                            aria-label={clienteExpanded ? 'Recolher cliente' : 'Expandir cliente'}
                          >
                            {clienteExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </button>
                        </td>
                        <td className="px-4 py-3 font-semibold">{cliente.nome}</td>
                        <td className="px-4 py-3 text-sm">{clienteSummary.status}</td>
                        <td className="px-4 py-3 text-sm">{clienteSummary.responsavel}</td>
                        <td className="px-4 py-3">{cliente.itemCount}</td>
                        <td className="px-4 py-3">{formatHours(cliente.totalHoras)}</td>
                        <td className="px-4 py-3 text-right">{formatMoney(cliente.totalValor)}</td>
                        <td className="px-4 py-3 text-right text-muted-foreground">—</td>
                      </tr>

                      {clienteExpanded &&
                        cliente.contratos.map((contrato) => {
                          const contratoExpanded = expandedContratos[contrato.key] ?? true
                          const contratoItems = contrato.casos.flatMap((ca) => ca.itens)
                          const contratoSummary = summarizeStatusAndResponsavel(contratoItems)
                          const metrics = contrato.casos.reduce(
                            (acc, ca) => {
                              const m = getCasoDisplayMetrics(ca.itens)
                              acc.h += m.totalHoras
                              acc.v += m.totalValor
                              acc.n += m.itemCount
                              return acc
                            },
                            { h: 0, v: 0, n: 0 },
                          )
                          const eligibleContrato = collectEligibleIdsUnderContrato(contrato)
                          const selectedContrato = eligibleContrato.filter((id) => !!selectedFaturamentoItems[id]).length

                          return (
                            <Fragment key={contrato.key}>
                              <tr>
                                <td className="px-2 py-3">
                                  <input
                                    type="checkbox"
                                    checked={
                                      eligibleContrato.length > 0 && selectedContrato === eligibleContrato.length
                                    }
                                    ref={(element) => {
                                      if (element) {
                                        element.indeterminate =
                                          selectedContrato > 0 && selectedContrato < eligibleContrato.length
                                      }
                                    }}
                                    onChange={(event) =>
                                      toggleSelectionForItemIds(eligibleContrato, event.target.checked)
                                    }
                                    disabled={
                                      eligibleContrato.length === 0 ||
                                      loading ||
                                      loadingContratos ||
                                      faturandoSelecionados
                                    }
                                  />
                                </td>
                                <td className="px-2 py-3">
                                  <button
                                    type="button"
                                    className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-muted-foreground hover:border-border hover:bg-muted"
                                    onClick={() =>
                                      setExpandedContratos((p) => ({ ...p, [contrato.key]: !contratoExpanded }))
                                    }
                                    aria-label={contratoExpanded ? 'Recolher contrato' : 'Expandir contrato'}
                                  >
                                    {contratoExpanded ? (
                                      <ChevronDown className="h-4 w-4" />
                                    ) : (
                                      <ChevronRight className="h-4 w-4" />
                                    )}
                                  </button>
                                </td>
                                <td className="px-4 py-3 pl-10 font-medium">
                                  {contrato.numero ? `${contrato.numero} - ` : ''}
                                  {contrato.nome}
                                </td>
                                <td className="px-4 py-3 text-sm">{contratoSummary.status}</td>
                                <td className="px-4 py-3 text-sm">{contratoSummary.responsavel}</td>
                                <td className="px-4 py-3">{metrics.n}</td>
                                <td className="px-4 py-3">{formatHours(metrics.h)}</td>
                                <td className="px-4 py-3 text-right">{formatMoney(metrics.v)}</td>
                                <td className="px-4 py-3 text-right text-muted-foreground">—</td>
                              </tr>

                              {contratoExpanded &&
                                contrato.casos.map((casoG) => {
                                  const casoExpanded = expandedCasos[casoG.key] ?? true
                                  const casoSummary = summarizeStatusAndResponsavel(casoG.itens)
                                  const caseMetrics = getCasoDisplayMetrics(casoG.itens)
                                  const eligibleCaso = collectEligibleIdsUnderCaso(casoG)
                                  const selectedCaso = eligibleCaso.filter((id) => !!selectedFaturamentoItems[id]).length

                                  return (
                                    <Fragment key={casoG.key}>
                                      <tr>
                                        <td className="px-2 py-3">
                                          <input
                                            type="checkbox"
                                            checked={
                                              eligibleCaso.length > 0 && selectedCaso === eligibleCaso.length
                                            }
                                            ref={(element) => {
                                              if (element) {
                                                element.indeterminate =
                                                  selectedCaso > 0 && selectedCaso < eligibleCaso.length
                                              }
                                            }}
                                            onChange={(event) =>
                                              toggleSelectionForItemIds(eligibleCaso, event.target.checked)
                                            }
                                            disabled={
                                              eligibleCaso.length === 0 ||
                                              loading ||
                                              loadingContratos ||
                                              faturandoSelecionados
                                            }
                                          />
                                        </td>
                                        <td className="px-2 py-3">
                                          <button
                                            type="button"
                                            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-muted-foreground hover:border-border hover:bg-muted"
                                            onClick={() =>
                                              setExpandedCasos((p) => ({ ...p, [casoG.key]: !casoExpanded }))
                                            }
                                            aria-label={casoExpanded ? 'Recolher caso' : 'Expandir caso'}
                                          >
                                            {casoExpanded ? (
                                              <ChevronDown className="h-4 w-4" />
                                            ) : (
                                              <ChevronRight className="h-4 w-4" />
                                            )}
                                          </button>
                                        </td>
                                        <td className="px-4 py-3 pl-16 text-muted-foreground">
                                          {casoG.numero ? `${casoG.numero} - ` : ''}
                                          {casoG.nome}
                                        </td>
                                        <td className="px-4 py-3 text-sm text-muted-foreground">
                                          {casoSummary.status}
                                        </td>
                                        <td className="px-4 py-3 text-sm text-muted-foreground">
                                          {casoSummary.responsavel}
                                        </td>
                                        <td className="px-4 py-3 text-muted-foreground">{caseMetrics.itemCount}</td>
                                        <td className="px-4 py-3 text-muted-foreground">
                                          {formatHours(caseMetrics.totalHoras)}
                                        </td>
                                        <td className="px-4 py-3 text-right text-muted-foreground">
                                          {formatMoney(caseMetrics.totalValor)}
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                          <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={() => setResumoCasoKey(casoG.key)}
                                            disabled={casoG.itens.length === 0}
                                          >
                                            <Eye className="mr-1 h-3.5 w-3.5" />
                                            Visualizar
                                          </Button>
                                        </td>
                                      </tr>

                                      {casoExpanded ? (
                                        <tr>
                                          <td colSpan={9} className="bg-muted/20 px-4 py-3">
                                            <div className="rounded-md border bg-white">
                                              <Table className="w-full min-w-full">
                                                <thead className="bg-gray-50">
                                                  <tr>
                                                    <th className="w-10 px-3 py-2 text-left" />
                                                    <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">
                                                      Regra / tipo
                                                    </th>
                                                    <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">
                                                      Referência
                                                    </th>
                                                    <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">
                                                      Status
                                                    </th>
                                                    <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">
                                                      Responsável
                                                    </th>
                                                    <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">
                                                      Horas
                                                    </th>
                                                    <th className="px-3 py-2 text-right text-xs font-medium uppercase text-gray-500">
                                                      Valor
                                                    </th>
                                                    <th className="px-3 py-2 text-right text-xs font-medium uppercase text-gray-500">
                                                      Ações
                                                    </th>
                                                  </tr>
                                                </thead>
                                                <tbody className="divide-y divide-gray-100">
                                                  {casoG.itens.map((itemRow) => {
                                                    const detalhe = itemToDetalhe(itemRow)
                                                    const canBill = isDetalheFaturavel(detalhe)
                                                    const busy =
                                                      faturandoSelecionados || faturandoItemId === detalhe.id
                                                    return (
                                                      <tr key={detalhe.id} className={getDetalheRowClass(detalhe.status)}>
                                                        <td className="px-3 py-2">
                                                          <input
                                                            type="checkbox"
                                                            checked={!!selectedFaturamentoItems[detalhe.id]}
                                                            onChange={(event) =>
                                                              toggleSelectionForItemIds(
                                                                [detalhe.id],
                                                                event.target.checked,
                                                              )
                                                            }
                                                            disabled={
                                                              !canBill ||
                                                              loading ||
                                                              loadingContratos ||
                                                              faturandoSelecionados
                                                            }
                                                          />
                                                        </td>
                                                        <td className="px-3 py-2 text-sm">{detalhe.descricao}</td>
                                                        <td className="px-3 py-2 text-sm">{detalhe.referencia || '-'}</td>
                                                        <td className="px-3 py-2 text-sm">{detalhe.statusLabel}</td>
                                                        <td className="px-3 py-2 text-sm">{detalhe.responsavelAtual}</td>
                                                        <td className="px-3 py-2 text-sm">{formatHours(detalhe.horas)}</td>
                                                        <td className="px-3 py-2 text-right text-sm">
                                                          {formatMoney(detalhe.valor)}
                                                        </td>
                                                        <td className="px-3 py-2 text-right">
                                                          <div className="flex justify-end gap-1">
                                                            <Button
                                                              size="icon"
                                                              variant="ghost"
                                                              title="Transferir para outro caso"
                                                              onClick={() => {
                                                                setTransferCasoId('')
                                                                setTransferItemId(detalhe.id)
                                                              }}
                                                            >
                                                              <ArrowRightLeft className="h-4 w-4" />
                                                            </Button>
                                                            {canBill ? (
                                                              <Button
                                                                size="icon"
                                                                variant="ghost"
                                                                onClick={() => void faturarSingleItem(detalhe.id)}
                                                                disabled={busy}
                                                              >
                                                                {busy ? (
                                                                  <Loader2 className="h-4 w-4 animate-spin" />
                                                                ) : (
                                                                  <DollarSign className="h-4 w-4" />
                                                                )}
                                                              </Button>
                                                            ) : (
                                                              <span className="inline-flex w-10 justify-center text-xs text-muted-foreground">
                                                                —
                                                              </span>
                                                            )}
                                                          </div>
                                                        </td>
                                                      </tr>
                                                    )
                                                  })}
                                                </tbody>
                                              </Table>
                                            </div>
                                          </td>
                                        </tr>
                                      ) : null}
                                    </Fragment>
                                  )
                                })}
                            </Fragment>
                          )
                        })}
                      {clienteIndex < tree.length - 1 ? (
                        <tr>
                          <td colSpan={9} className="h-4 border-0 bg-transparent" />
                        </tr>
                      ) : null}
                    </Fragment>
                  )
                })
              )}
            </tbody>
          </Table>
        </div>
      </div>

      <Dialog open={!!resumoCasoKey && !!resumoCasoGroup} onOpenChange={(open) => !open && setResumoCasoKey(null)}>
        <DialogContent className="max-w-7xl">
          <DialogHeader>
            <DialogTitle>Resumo do caso</DialogTitle>
            <DialogDescription>
              {resumoCasoGroup
                ? `${resumoCasoGroup.cliente.nome} · ${resumoCasoGroup.contrato.numero ? `${resumoCasoGroup.contrato.numero} - ` : ''}${resumoCasoGroup.contrato.nome} · ${resumoCasoGroup.caso.numero ? `${resumoCasoGroup.caso.numero} - ` : ''}${resumoCasoGroup.caso.nome}`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto py-2">
            <div className="overflow-x-auto rounded-md border">
              <Table className="w-full min-w-[1240px] text-xs">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left">Contrato</th>
                    <th className="px-3 py-2 text-left">Caso</th>
                    <th className="px-3 py-2 text-left">Data</th>
                    <th className="px-3 py-2 text-left">Profissional</th>
                    <th className="px-3 py-2 text-left">Atividade</th>
                    <th className="px-3 py-2 text-left">Revisor</th>
                    <th className="px-3 py-2 text-left">Aprovador</th>
                    <th className="px-3 py-2 text-right">Horas informadas</th>
                    <th className="px-3 py-2 text-right">Horas revisadas</th>
                    <th className="px-3 py-2 text-right">Valor final</th>
                  </tr>
                </thead>
                <tbody>
                  {resumoCasoGroup ? (
                    buildResumoCasoDialogRows(resumoCasoGroup).map((row) => (
                      <tr key={row.key} className="border-t align-top">
                        <td className="px-3 py-2">{row.contrato}</td>
                        <td className="px-3 py-2">{row.caso}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{row.data}</td>
                        <td className="px-3 py-2">{row.profissional}</td>
                        <td className="px-3 py-2">{row.atividade}</td>
                        <td className="px-3 py-2">{row.revisor}</td>
                        <td className="px-3 py-2">{row.aprovador}</td>
                        <td className="px-3 py-2 text-right">{formatNullableHours(row.horasInformadas)}</td>
                        <td className="px-3 py-2 text-right">{formatNullableHours(row.horasRevisadas)}</td>
                        <td className="px-3 py-2 text-right">{formatNullableMoney(row.valorFinal)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={10} className="px-3 py-6 text-center text-muted-foreground">
                        Nenhum item encontrado para este caso.
                      </td>
                    </tr>
                  )}
                </tbody>
              </Table>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setResumoCasoKey(null)} disabled={devolvendo}>
              Fechar
            </Button>
            <Button
              variant="destructive"
              onClick={() => void devolverCasoParaRevisao()}
              disabled={
                devolvendo ||
                !resumoCasoGroup?.caso.itens.some(
                  (it) => it.status === 'em_aprovacao' || it.status === 'aprovado',
                )
              }
            >
              {devolvendo ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Undo2 className="mr-2 h-4 w-4" />}
              Devolver para revisão
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!transferItemId}
        onOpenChange={(open) => {
          if (!open) {
            setTransferItemId(null)
            setTransferCasoId('')
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Transferir para outro caso</DialogTitle>
            <DialogDescription>Selecione o caso de destino para reatribuir este lançamento.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <CommandSelect
              value={transferCasoId}
              onValueChange={setTransferCasoId}
              options={transferCasoOptions}
              placeholder="Selecione o caso de destino"
              searchPlaceholder="Buscar caso..."
              emptyText="Nenhum caso encontrado."
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setTransferItemId(null)
                setTransferCasoId('')
              }}
              disabled={transferring}
            >
              Cancelar
            </Button>
            <Button onClick={() => void handleTransferCaso()} disabled={transferring || !transferCasoId}>
              {transferring ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowRightLeft className="mr-2 h-4 w-4" />}
              Transferir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function formatNullableHours(value: number | null | undefined) {
  if (value === null || value === undefined) return '-'
  return formatHours(value)
}

function formatNullableMoney(value: number | null | undefined) {
  if (value === null || value === undefined) return '-'
  return formatMoney(value)
}
