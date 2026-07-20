'use client'

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Clock, Loader2, Send, X } from 'lucide-react'
import {
  clearAllExpansions,
  hasAnyExpansion,
} from '@/components/faturamento/itens-a-faturar-expansions'
import { shouldRefetchOnVisibility } from '@/components/faturamento/itens-a-faturar-refresh'
import { createClient } from '@/lib/supabase/client'
import { fetchWithRetry } from '@/lib/utils/fetch-with-retry'
import { formatContratoDisplay } from '@/lib/utils/contrato-display'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { DatePicker } from '@/components/ui/date-picker'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Table } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip } from '@/components/ui/tooltip'
import { useToast } from '@/components/ui/toast'

interface CasoAgrupado {
  caso_id: string
  caso_numero: number | null
  caso_nome: string
  total_horas: string
  total_valor: string
  total_itens: number
  extrato?: Array<{
    origem_id?: string
    tipo: string
    caso_regra?: string | null
    descricao: string
    data_referencia: string | null
    horas: string
    valor: string
  }>
}

interface ContratoAgrupado {
  contrato_id: string
  contrato_numero: number | null
  contrato_numero_sequencial: number | null
  contrato_nome: string
  total_horas: string
  total_valor: string
  total_itens: number
  casos: CasoAgrupado[]
}

interface ClienteAgrupado {
  cliente_id: string
  cliente_nome: string
  total_horas: string
  total_valor: string
  total_itens: number
  contratos: ContratoAgrupado[]
}

interface DespesaFallbackItem {
  id: string
  cliente_id: string
  cliente_nome: string
  contrato_id: string
  contrato_numero: number | null
  contrato_numero_sequencial?: number | null
  contrato_nome: string
  caso_id: string
  caso_numero: number | null
  caso_nome: string
  data_lancamento: string
  categoria: string
  descricao: string
  valor: number
  status: string
}

function toDateInput(date: Date) {
  return date.toISOString().slice(0, 10)
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function endOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0)
}

function formatMoney(value: number | string | null | undefined) {
  const amount = Number(value || 0)
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(amount)
}

function formatHours(value: number | string | null | undefined) {
  const amount = Number(value || 0)
  return amount.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatDate(value: string | null | undefined) {
  if (!value) return '-'
  const [year, month, day] = value.split('-')
  if (!year || !month || !day) return value
  return `${day}/${month}/${year}`
}

function formatBillingReference(tipo: string | null | undefined, value: string | null | undefined) {
  if (normalizeRuleType(tipo) === 'mensalidade' || normalizeRuleType(tipo) === 'mensalidade_processo') {
    const day = value?.split('-')[2]
    return day ? `dia ${Number(day)}` : '-'
  }
  return formatDate(value)
}

type RegraTabKey = 'todas' | 'hora' | 'mensalidade_processo' | 'mensalidade' | 'projeto' | 'projeto_parcelado' | 'exito' | 'despesa'

const REGRA_TABS: Array<{ key: RegraTabKey; label: string }> = [
  { key: 'todas', label: 'Todas' },
  { key: 'hora', label: 'Horas' },
  { key: 'mensalidade_processo', label: 'Mensalidade de processo' },
  { key: 'mensalidade', label: 'Mensalidade' },
  { key: 'projeto', label: 'Projeto' },
  { key: 'projeto_parcelado', label: 'Projeto parcelado' },
  { key: 'exito', label: 'Êxito' },
  { key: 'despesa', label: 'Despesas' },
]

function normalizeRuleType(tipo: string | null | undefined) {
  const normalized = (tipo || '').trim().toLowerCase()
  if (normalized === 'timesheet') return 'hora'
  if (normalized === 'mensal') return 'mensalidade'
  if (normalized === 'mensalidade_processo') return 'mensalidade_processo'
  if (normalized === 'projeto') return 'projeto'
  if (normalized === 'projeto_parcela') return 'projeto_parcelado'
  if (normalized === 'projeto_parcelado') return 'projeto_parcelado'
  if (normalized === 'exito') return 'exito'
  if (normalized === 'despesa') return 'despesa'
  return normalized
}

// Aba efetiva da linha: hora lançada herda a regra de cobrança do caso
// (ex.: hora em caso 'projeto' cai na aba Projeto, não em Horas).
function effectiveRuleType(linha: { tipo: string; caso_regra?: string | null }) {
  const base = normalizeRuleType(linha.tipo)
  if (base !== 'hora') return base
  const casoRegra = normalizeRuleType(linha.caso_regra)
  if (casoRegra === 'salario_minimo') return 'mensalidade_processo'
  if (casoRegra === 'hora' || casoRegra === 'hora_com_cap') return 'hora'
  // sem regra de cobrança => não entra em aba nenhuma (aparece só em Todas)
  return casoRegra || 'sem_regra'
}

function matchRuleTab(tab: RegraTabKey, linha: { tipo: string; caso_regra?: string | null }) {
  if (tab === 'todas') return true
  return effectiveRuleType(linha) === tab
}

function filterTreeByRule(items: ClienteAgrupado[], regraTab: RegraTabKey): ClienteAgrupado[] {
  const filteredClientes: ClienteAgrupado[] = []

  for (const cliente of items) {
    const filteredContratos: ContratoAgrupado[] = []

    for (const contrato of cliente.contratos || []) {
      const filteredCasos: CasoAgrupado[] = []

      for (const caso of contrato.casos || []) {
        const filteredExtrato = (Array.isArray(caso.extrato) ? caso.extrato : []).filter((linha) =>
          matchRuleTab(regraTab, linha),
        )
        if (filteredExtrato.length === 0) continue

        const totalHoras = filteredExtrato.reduce((acc, linha) => acc + Number(linha.horas || 0), 0)
        const totalValor = filteredExtrato.reduce((acc, linha) => acc + Number(linha.valor || 0), 0)

        filteredCasos.push({
          ...caso,
          total_horas: totalHoras.toFixed(2),
          total_valor: totalValor.toFixed(2),
          total_itens: filteredExtrato.length,
          extrato: filteredExtrato,
        })
      }

      if (filteredCasos.length === 0) continue
      const totalHorasContrato = filteredCasos.reduce((acc, caso) => acc + Number(caso.total_horas || 0), 0)
      const totalValorContrato = filteredCasos.reduce((acc, caso) => acc + Number(caso.total_valor || 0), 0)
      const totalItensContrato = filteredCasos.reduce((acc, caso) => acc + Number(caso.total_itens || 0), 0)

      filteredContratos.push({
        ...contrato,
        total_horas: totalHorasContrato.toFixed(2),
        total_valor: totalValorContrato.toFixed(2),
        total_itens: totalItensContrato,
        casos: filteredCasos,
      })
    }

    if (filteredContratos.length === 0) continue
    const totalHorasCliente = filteredContratos.reduce((acc, contrato) => acc + Number(contrato.total_horas || 0), 0)
    const totalValorCliente = filteredContratos.reduce((acc, contrato) => acc + Number(contrato.total_valor || 0), 0)
    const totalItensCliente = filteredContratos.reduce((acc, contrato) => acc + Number(contrato.total_itens || 0), 0)

    filteredClientes.push({
      ...cliente,
      total_horas: totalHorasCliente.toFixed(2),
      total_valor: totalValorCliente.toFixed(2),
      total_itens: totalItensCliente,
      contratos: filteredContratos,
    })
  }

  return filteredClientes
}

function toNumber(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function matchesDespesaSearch(item: DespesaFallbackItem, search: string) {
  const term = search.trim().toLowerCase()
  if (!term) return true
  const haystack = [
    item.cliente_nome,
    item.contrato_nome,
    item.caso_nome,
    item.categoria,
    item.descricao,
    item.data_lancamento,
    item.contrato_numero?.toString() || '',
    item.caso_numero?.toString() || '',
  ]
    .join(' ')
    .toLowerCase()
  return haystack.includes(term)
}

function cloneTree(items: ClienteAgrupado[]) {
  return (items || []).map((cliente) => ({
    ...cliente,
    contratos: (cliente.contratos || []).map((contrato) => ({
      ...contrato,
      casos: (contrato.casos || []).map((caso) => ({
        ...caso,
        extrato: Array.isArray(caso.extrato) ? caso.extrato.map((linha) => ({ ...linha })) : [],
      })),
    })),
  }))
}

function mergeFallbackDespesas(
  baseItems: ClienteAgrupado[],
  despesas: DespesaFallbackItem[],
  search: string,
): ClienteAgrupado[] {
  const merged = cloneTree(baseItems)

  for (const despesa of despesas || []) {
    if (!despesa?.id || !despesa.cliente_id || !despesa.contrato_id || !despesa.caso_id) continue
    if ((despesa.status || '').toLowerCase() !== 'em_lancamento') continue
    if (!matchesDespesaSearch(despesa, search)) continue

    let cliente = merged.find((entry) => entry.cliente_id === despesa.cliente_id)
    if (!cliente) {
      cliente = {
        cliente_id: despesa.cliente_id,
        cliente_nome: despesa.cliente_nome || 'Cliente sem nome',
        total_horas: '0.00',
        total_valor: '0.00',
        total_itens: 0,
        contratos: [],
      }
      merged.push(cliente)
    }

    let contrato = (cliente.contratos || []).find((entry) => entry.contrato_id === despesa.contrato_id)
    if (!contrato) {
      contrato = {
        contrato_id: despesa.contrato_id,
        contrato_numero: despesa.contrato_numero ?? null,
        contrato_numero_sequencial: despesa.contrato_numero_sequencial ?? null,
        contrato_nome: despesa.contrato_nome || 'Contrato sem nome',
        total_horas: '0.00',
        total_valor: '0.00',
        total_itens: 0,
        casos: [],
      }
      cliente.contratos.push(contrato)
    }

    let caso = (contrato.casos || []).find((entry) => entry.caso_id === despesa.caso_id)
    if (!caso) {
      caso = {
        caso_id: despesa.caso_id,
        caso_numero: despesa.caso_numero ?? null,
        caso_nome: despesa.caso_nome || 'Caso sem nome',
        total_horas: '0.00',
        total_valor: '0.00',
        total_itens: 0,
        extrato: [],
      }
      contrato.casos.push(caso)
    }

    const extrato = Array.isArray(caso.extrato) ? caso.extrato : []
    const alreadyExists = extrato.some((linha) => linha.tipo === 'despesa' && linha.origem_id === despesa.id)
    if (alreadyExists) continue

    extrato.push({
      origem_id: despesa.id,
      tipo: 'despesa',
      descricao: `Despesa${despesa.categoria ? ` - ${despesa.categoria}` : ''}`,
      data_referencia: despesa.data_lancamento || null,
      horas: '0.00',
      valor: toNumber(despesa.valor).toFixed(2),
    })
    caso.extrato = extrato
  }

  for (const cliente of merged) {
    let clienteHoras = 0
    let clienteValor = 0
    let clienteItens = 0

    for (const contrato of cliente.contratos || []) {
      let contratoHoras = 0
      let contratoValor = 0
      let contratoItens = 0

      for (const caso of contrato.casos || []) {
        if (Array.isArray(caso.extrato) && caso.extrato.length > 0) {
          const horasCaso = caso.extrato.reduce((acc, linha) => acc + toNumber(linha.horas), 0)
          const valorCaso = caso.extrato.reduce((acc, linha) => acc + toNumber(linha.valor), 0)
          caso.total_horas = horasCaso.toFixed(2)
          caso.total_valor = valorCaso.toFixed(2)
          caso.total_itens = caso.extrato.length
        }

        contratoHoras += toNumber(caso.total_horas)
        contratoValor += toNumber(caso.total_valor)
        contratoItens += Number(caso.total_itens || 0)
      }

      contrato.total_horas = contratoHoras.toFixed(2)
      contrato.total_valor = contratoValor.toFixed(2)
      contrato.total_itens = contratoItens

      clienteHoras += contratoHoras
      clienteValor += contratoValor
      clienteItens += contratoItens
    }

    cliente.total_horas = clienteHoras.toFixed(2)
    cliente.total_valor = clienteValor.toFixed(2)
    cliente.total_itens = clienteItens
  }

  return merged
}

export default function ItensAFaturarList() {
  const today = new Date()
  const { success, error: toastError } = useToast()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [items, setItems] = useState<ClienteAgrupado[]>([])
  const [search, setSearch] = useState('')
  const [dateStart, setDateStart] = useState(toDateInput(startOfMonth(today)))
  const [dateEnd, setDateEnd] = useState(toDateInput(endOfMonth(today)))
  const [expandedClientes, setExpandedClientes] = useState<Record<string, boolean>>({})
  const [expandedContratos, setExpandedContratos] = useState<Record<string, boolean>>({})
  const [expandedCasos, setExpandedCasos] = useState<Record<string, boolean>>({})
  const [sendingTarget, setSendingTarget] = useState<string | null>(null)
  const [regraTab, setRegraTab] = useState<RegraTabKey>('todas')
  const [selectedCasos, setSelectedCasos] = useState<Record<string, boolean>>({})
  const [postergarTarget, setPostergarTarget] = useState<{
    casoId: string
    casoNome: string
    extrato: CasoAgrupado['extrato']
  } | null>(null)
  const [postergarDate, setPostergarDate] = useState<string>('')
  const [postergarSubmitting, setPostergarSubmitting] = useState(false)

  const anyExpanded = hasAnyExpansion({ expandedClientes, expandedContratos, expandedCasos })

  const collapseAll = useCallback(() => {
    const cleared = clearAllExpansions()
    setExpandedClientes(cleared.expandedClientes)
    setExpandedContratos(cleared.expandedContratos)
    setExpandedCasos(cleared.expandedCasos)
  }, [])

  useEffect(() => {
    if (!anyExpanded) return
    const handler = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      const target = event.target as HTMLElement | null
      if (target) {
        const tag = target.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) {
          return
        }
      }
      collapseAll()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [anyExpanded, collapseAll])

  const lastFetchAtRef = useRef<number | null>(null)

  const getFunctionsHeaders = (accessToken: string) => {
    // O header `apikey` triggera CORS preflight nas edges get-itens-a-faturar e
    // get-despesas (causa do banner "Erro ao carregar itens a faturar" reportado
    // por Filipe em prod 25/04). Sem ele, ambas respondem 200 normalmente —
    // Authorization Bearer cobre a auth.
    return {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    }
  }

  const loadItems = async (signal?: AbortSignal) => {
    try {
      setLoading(true)
      setError(null)
      const supabase = createClient()
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session) return
      if (signal?.aborted) return

      const params = new URLSearchParams({
        data_inicio: dateStart,
        data_fim: dateEnd,
      })
      if (search.trim()) params.set('search', search.trim())

      const response = await fetchWithRetry(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-itens-a-faturar?${params.toString()}`,
        {
          method: 'GET',
          signal,
          headers: {
            ...getFunctionsHeaders(session.access_token),
          },
        },
      )

      const payload = await response.json()
      if (!response.ok) {
        setError(payload.error || 'Erro ao carregar itens a faturar')
        setItems([])
        return
      }

      const data = (payload.data || []) as ClienteAgrupado[]

      const despesasParams = new URLSearchParams({
        data_inicio: dateStart,
        data_fim: dateEnd,
        status: 'em_lancamento',
      })
      const despesasResponse = await fetchWithRetry(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-despesas?${despesasParams.toString()}`,
        {
          method: 'GET',
          signal,
          headers: {
            ...getFunctionsHeaders(session.access_token),
          },
        },
      )
      const despesasPayload = await despesasResponse.json().catch(() => ({}))
      const despesasData = Array.isArray(despesasPayload?.data) ? (despesasPayload.data as DespesaFallbackItem[]) : []

      if (signal?.aborted) return
      const mergedData = mergeFallbackDespesas(data, despesasData, search)
      setItems(mergedData)

      const nextExpandedClientes: Record<string, boolean> = {}
      const nextExpandedContratos: Record<string, boolean> = {}
      const nextExpandedCasos: Record<string, boolean> = {}
      for (const cliente of mergedData) {
        nextExpandedClientes[cliente.cliente_id] = false
        for (const contrato of cliente.contratos || []) {
          nextExpandedContratos[contrato.contrato_id] = false
          for (const caso of contrato.casos || []) {
            nextExpandedCasos[caso.caso_id] = false
          }
        }
      }
      setExpandedClientes(nextExpandedClientes)
      setExpandedContratos(nextExpandedContratos)
      setExpandedCasos(nextExpandedCasos)
      setSelectedCasos({})
      lastFetchAtRef.current = Date.now()
    } catch (err) {
      // Caller cancelou (unmount/dependency change): silenciar
      if (err instanceof DOMException && err.name === 'AbortError') return
      console.error(err)
      setError('Erro ao carregar itens a faturar')
      setItems([])
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }

  useEffect(() => {
    const ac = new AbortController()
    void loadItems(ac.signal)
    return () => ac.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadItemsRef = useRef(loadItems)
  useEffect(() => {
    loadItemsRef.current = loadItems
  })

  useEffect(() => {
    const handler = () => {
      if (
        shouldRefetchOnVisibility({
          visibilityState: document.visibilityState,
          lastFetchAt: lastFetchAtRef.current,
          now: Date.now(),
        })
      ) {
        void loadItemsRef.current()
      }
    }
    document.addEventListener('visibilitychange', handler)
    return () => document.removeEventListener('visibilitychange', handler)
  }, [])

  const filteredTree = useMemo(() => filterTreeByRule(items, regraTab), [items, regraTab])

  const totals = useMemo(
    () =>
      filteredTree.reduce(
        (acc, cliente) => {
          acc.valor += Number(cliente.total_valor || 0)
          acc.horas += Number(cliente.total_horas || 0)
          acc.itens += Number(cliente.total_itens || 0)
          return acc
        },
        { valor: 0, horas: 0, itens: 0 },
      ),
    [filteredTree],
  )

  const visibleCaseIds = useMemo(
    () =>
      filteredTree.flatMap((cliente) =>
        (cliente.contratos || []).flatMap((contrato) => (contrato.casos || []).map((caso) => caso.caso_id)),
      ),
    [filteredTree],
  )

  const selectedVisibleCount = useMemo(
    () => visibleCaseIds.filter((casoId) => selectedCasos[casoId]).length,
    [visibleCaseIds, selectedCasos],
  )

  const startFlow = async (targetType: 'cliente' | 'contrato' | 'caso', targetId: string, label: string) => {
    try {
      setSendingTarget(targetId)
      const supabase = createClient()
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session) return

      const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/start-faturamento`, {
        method: 'POST',
        headers: {
          ...getFunctionsHeaders(session.access_token),
        },
        body: JSON.stringify({
          data_inicio: dateStart,
          data_fim: dateEnd,
          alvo_tipo: targetType,
          alvo_id: targetId,
          search: search.trim() || null,
        }),
      })

      const payload = await response.json()
      if (!response.ok) {
        toastError(payload.error || `Erro ao enviar ${label} para revisão`)
        return
      }

      const created = Number(payload?.data?.itens_criados || 0)
      const batchNumber = payload?.data?.batch_numero
      success(
        batchNumber
          ? `${label} enviado para revisão no lote #${batchNumber} (${created} itens).`
          : `${label} enviado para revisão (${created} itens).`,
      )
      await loadItems()
    } catch (err) {
      console.error(err)
      toastError(`Erro ao enviar ${label} para revisão`)
    } finally {
      setSendingTarget(null)
    }
  }

  const openPostergar = (caso: CasoAgrupado) => {
    setPostergarTarget({
      casoId: caso.caso_id,
      casoNome: caso.caso_nome,
      extrato: Array.isArray(caso.extrato) ? caso.extrato : [],
    })
    setPostergarDate('')
  }

  const closePostergar = () => {
    if (postergarSubmitting) return
    setPostergarTarget(null)
    setPostergarDate('')
  }

  const confirmPostergar = async () => {
    if (!postergarTarget) return
    if (!postergarDate) {
      toastError('Selecione a nova data de faturamento.')
      return
    }
    const timesheetIds = (postergarTarget.extrato || [])
      .filter((linha) => {
        const tipo = (linha.tipo || '').trim().toLowerCase()
        return Boolean(linha.origem_id) && (tipo === 'timesheet' || tipo === 'hora')
      })
      .map((linha) => linha.origem_id as string)

    if (timesheetIds.length === 0) {
      toastError('Este caso não tem lançamentos de timesheet postergáveis.')
      return
    }

    try {
      setPostergarSubmitting(true)
      const supabase = createClient()
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session) return

      let okCount = 0
      let failCount = 0
      for (const timesheetId of timesheetIds) {
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/update-timesheet`,
          {
            method: 'POST',
            headers: {
              ...getFunctionsHeaders(session.access_token),
            },
            body: JSON.stringify({
              id: timesheetId,
              periodo_faturamento: postergarDate,
            }),
          },
        )
        if (response.ok) okCount += 1
        else failCount += 1
      }

      if (okCount > 0) {
        const [year, month, day] = postergarDate.split('-')
        const label = day && month && year ? `${day}/${month}/${year}` : postergarDate
        success(`${okCount} lançamento(s) postergado(s) para ${label}.`)
      }
      if (failCount > 0) {
        toastError(`${failCount} lançamento(s) não puderam ser postergados.`)
      }

      setPostergarTarget(null)
      setPostergarDate('')
      await loadItems()
    } catch (err) {
      console.error(err)
      toastError('Erro ao postergar lançamentos.')
    } finally {
      setPostergarSubmitting(false)
    }
  }

  const startFlowForSelectedCases = async () => {
    const selectedIds = visibleCaseIds.filter((casoId) => selectedCasos[casoId])
    if (selectedIds.length === 0) {
      toastError('Selecione ao menos um item para enviar ao fluxo.')
      return
    }

    try {
      setSendingTarget('__bulk__')
      const supabase = createClient()
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session) return

      let created = 0
      for (const caseId of selectedIds) {
        const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/start-faturamento`, {
          method: 'POST',
          headers: {
            ...getFunctionsHeaders(session.access_token),
          },
          body: JSON.stringify({
            data_inicio: dateStart,
            data_fim: dateEnd,
            alvo_tipo: 'caso',
            alvo_id: caseId,
            search: search.trim() || null,
          }),
        })

        const payload = await response.json().catch(() => ({}))
        if (!response.ok) {
          toastError(payload.error || 'Erro ao enviar itens selecionados para revisão')
          return
        }
        created += Number(payload?.data?.itens_criados || 0)
      }

      success(`Itens selecionados enviados para revisão (${created} itens).`)
      setSelectedCasos({})
      await loadItems()
    } catch (err) {
      console.error(err)
      toastError('Erro ao enviar itens selecionados para revisão')
    } finally {
      setSendingTarget(null)
    }
  }

  return (
    <div className="space-y-4">
      {error ? (
        <Alert className="border border-destructive/30 bg-destructive/10 text-destructive">
          <AlertTitle>Atenção</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-3 md:grid-cols-4">
        <div className="space-y-1">
          <label className="text-sm font-medium">Data inicial</label>
          <DatePicker value={dateStart} onChange={setDateStart} />
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium">Data final</label>
          <DatePicker value={dateEnd} onChange={setDateEnd} />
        </div>
        <div className="space-y-1 md:col-span-2">
          <label className="text-sm font-medium">Busca</label>
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Cliente, contrato, caso ou código"
          />
        </div>
      </div>

      <div className="flex items-center justify-between rounded-md border bg-muted/30 p-3">
        <div className="text-sm text-muted-foreground">
          <span className="mr-4">Clientes: <strong className="text-foreground">{items.length}</strong></span>
          <span className="mr-4">Itens: <strong className="text-foreground">{totals.itens}</strong></span>
          <span>Horas: <strong className="text-foreground">{formatHours(totals.horas)}</strong></span>
        </div>
        <div className="text-sm font-semibold font-tabular">{formatMoney(totals.valor)}</div>
      </div>

      <Tabs value={regraTab} defaultValue="todas" onValueChange={(value) => setRegraTab(value as RegraTabKey)}>
        <TabsList className="h-auto flex-wrap justify-start">
          {REGRA_TABS.map((tab) => (
            <TabsTrigger key={tab.key} value={tab.key}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-sm text-ink-secondary">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-hairline"
            checked={visibleCaseIds.length > 0 && selectedVisibleCount === visibleCaseIds.length}
            ref={(element) => {
              if (element) {
                element.indeterminate = selectedVisibleCount > 0 && selectedVisibleCount < visibleCaseIds.length
              }
            }}
            onChange={(event) => {
              const checked = event.target.checked
              setSelectedCasos((prev) => {
                const next = { ...prev }
                for (const caseId of visibleCaseIds) {
                  next[caseId] = checked
                }
                return next
              })
            }}
          />
          Selecionar todos
        </label>
        <div className="flex items-center gap-2">
          {anyExpanded ? (
            <Button variant="ghost" size="sm" onClick={collapseAll} aria-label="Fechar tudo" title="Fechar tudo (ESC)">
              <X className="mr-2 h-4 w-4" />
              Fechar tudo
            </Button>
          ) : null}
          <Button
            className="rounded-full bg-[#E8871E] text-white hover:opacity-90"
            onClick={() => void startFlowForSelectedCases()}
            disabled={loading || sendingTarget === '__bulk__' || selectedVisibleCount === 0}
          >
            {sendingTarget === '__bulk__' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
            Enviar selecionados p/ revisão ({selectedVisibleCount})
          </Button>
          <Button variant="outline" onClick={() => void loadItems()} disabled={loading}>
            {loading ? 'Atualizando...' : 'Atualizar lista'}
          </Button>
        </div>
      </div>

      {/* Mesma estrutura visual da 2. Revisão de fatura (pedido 20/07):
          cliente -> caso direto, header com totais, barra de ações por caso.
          Aqui a única ação de fluxo é enviar para revisão. */}
      {loading ? (
        <p className="rounded-xl border border-hairline bg-white px-4 py-8 text-center text-sm text-muted-foreground">Carregando...</p>
      ) : filteredTree.length === 0 ? (
        <p className="rounded-xl border border-hairline bg-white px-4 py-8 text-center text-sm text-muted-foreground">
          Nenhum item pendente de faturamento para o período informado. O período pode já ter sido faturado ou não há lançamentos abertos.
        </p>
      ) : (
        <div className="space-y-3">
          {filteredTree.map((cliente) => {
            const clienteExpanded = expandedClientes[cliente.cliente_id]
            const casosDoCliente = (cliente.contratos || []).flatMap((contrato) => contrato.casos || [])
            const clienteCaseIds = casosDoCliente.map((caso) => caso.caso_id)
            const clienteSelected = clienteCaseIds.filter((casoId) => selectedCasos[casoId]).length
            return (
              <section key={cliente.cliente_id} className="overflow-hidden rounded-xl border border-hairline bg-white">
                <div className="flex flex-wrap items-center gap-3 bg-canvas-soft/70 px-4 py-3">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-hairline"
                    checked={clienteCaseIds.length > 0 && clienteSelected === clienteCaseIds.length}
                    ref={(element) => {
                      if (element) {
                        element.indeterminate = clienteSelected > 0 && clienteSelected < clienteCaseIds.length
                      }
                    }}
                    onChange={(event) => {
                      const checked = event.target.checked
                      setSelectedCasos((prev) => {
                        const next = { ...prev }
                        for (const caseId of clienteCaseIds) {
                          next[caseId] = checked
                        }
                        return next
                      })
                    }}
                  />
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    onClick={() => setExpandedClientes((prev) => ({ ...prev, [cliente.cliente_id]: !clienteExpanded }))}
                  >
                    {clienteExpanded ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-ink">{cliente.cliente_nome}</span>
                      <span className="block text-xs text-ink-mute">
                        {cliente.total_itens} item(ns) · {formatHours(cliente.total_horas)} h
                      </span>
                    </span>
                  </button>
                  <span className="shrink-0 text-sm font-semibold font-tabular text-ink">{formatMoney(cliente.total_valor)}</span>
                  <Tooltip content={sendingTarget === cliente.cliente_id ? 'Enviando cliente...' : 'Enviar cliente inteiro p/ revisão'}>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={!!sendingTarget}
                      onClick={() => void startFlow('cliente', cliente.cliente_id, `Cliente ${cliente.cliente_nome}`)}
                    >
                      {sendingTarget === cliente.cliente_id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    </Button>
                  </Tooltip>
                </div>

                {clienteExpanded ? (
                  <div className="space-y-3 px-4 py-3">
                    {casosDoCliente.map((caso) => {
                      const casoExpanded = expandedCasos[caso.caso_id]
                      const extrato = Array.isArray(caso.extrato) ? caso.extrato : []
                      return (
                        <div key={caso.caso_id} className="overflow-hidden rounded-lg border border-hairline">
                          <div className="flex flex-wrap items-center gap-2 border-b border-hairline px-3 py-2">
                            <input
                              type="checkbox"
                              className="h-4 w-4 rounded border-hairline"
                              checked={!!selectedCasos[caso.caso_id]}
                              onChange={(event) =>
                                setSelectedCasos((prev) => ({ ...prev, [caso.caso_id]: event.target.checked }))
                              }
                            />
                            <button
                              type="button"
                              className="flex min-w-0 flex-1 items-center gap-2 text-left"
                              onClick={() => setExpandedCasos((prev) => ({ ...prev, [caso.caso_id]: !casoExpanded }))}
                            >
                              {casoExpanded ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                              <span className="min-w-0">
                                <span className="block truncate text-sm font-medium text-ink">
                                  {caso.caso_numero ? `${caso.caso_numero} - ` : ''}{caso.caso_nome}
                                </span>
                                <span className="block text-xs text-ink-mute">
                                  {caso.total_itens} item(ns) · {formatHours(caso.total_horas)} h
                                </span>
                              </span>
                            </button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="rounded-full text-xs"
                              disabled={!!sendingTarget || postergarSubmitting}
                              onClick={() => openPostergar(caso)}
                            >
                              <Clock className="mr-1 h-3.5 w-3.5" /> Postergar
                            </Button>
                            <Button
                              size="sm"
                              className="rounded-full bg-[#E8871E] text-xs text-white hover:opacity-90"
                              disabled={!!sendingTarget}
                              onClick={() =>
                                void startFlow(
                                  'caso',
                                  caso.caso_id,
                                  `Caso ${caso.caso_numero ? `${caso.caso_numero} - ` : ''}${caso.caso_nome}`,
                                )
                              }
                            >
                              {sendingTarget === caso.caso_id ? (
                                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Send className="mr-1 h-3.5 w-3.5" />
                              )}
                              Enviar p/ revisão
                            </Button>
                            <span className="shrink-0 text-sm font-semibold font-tabular text-ink">{formatMoney(caso.total_valor)}</span>
                          </div>

                          {casoExpanded ? (
                            <div className="overflow-x-auto">
                              <table className="w-full min-w-[560px] text-left">
                                <thead>
                                  <tr className="border-b text-[10px] uppercase tracking-wide text-ink-mute">
                                    <th className="px-3 py-2">Data</th>
                                    <th className="px-3 py-2">Descrição</th>
                                    <th className="px-3 py-2 text-right">Horas</th>
                                    <th className="px-3 py-2 text-right">Valor</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-hairline">
                                  {extrato.map((linha, index) => (
                                    <tr key={`${caso.caso_id}-linha-${index}`}>
                                      <td className="whitespace-nowrap px-3 py-2.5 text-xs text-ink-secondary">
                                        {formatBillingReference(linha.tipo, linha.data_referencia)}
                                      </td>
                                      <td className="px-3 py-2.5 text-[11px] leading-snug text-ink-secondary">
                                        <span className="block max-w-[560px] whitespace-normal break-words">{linha.descricao || linha.tipo}</span>
                                      </td>
                                      <td className="whitespace-nowrap px-3 py-2.5 text-right text-xs font-tabular text-ink-secondary">
                                        {Number(linha.horas || 0) > 0 ? formatHours(linha.horas) : '—'}
                                      </td>
                                      <td className="whitespace-nowrap px-3 py-2.5 text-right text-xs font-medium font-tabular text-ink">
                                        {formatMoney(linha.valor)}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
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

      <Dialog
        open={postergarTarget !== null}
        onOpenChange={(open) => {
          if (!open) closePostergar()
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Postergar fatura</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-ink-mute">
              Selecione a nova data para os lançamentos do caso{' '}
              <strong className="text-ink">{postergarTarget?.casoNome}</strong>.
            </p>
            <div className="space-y-1">
              <label className="text-sm font-medium">Nova data de faturamento</label>
              <DatePicker value={postergarDate} onChange={setPostergarDate} />
            </div>
            <p className="text-xs text-ink-mute">
              Os lançamentos serão movidos para o período da data escolhida e reaparecerão na lista nesse novo período.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closePostergar} disabled={postergarSubmitting}>
              Cancelar
            </Button>
            <Button
              className="bg-primary hover:bg-primary-deep text-primary-foreground"
              onClick={() => void confirmPostergar()}
              disabled={postergarSubmitting || !postergarDate}
            >
              {postergarSubmitting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Clock className="mr-2 h-4 w-4" />
              )}
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
