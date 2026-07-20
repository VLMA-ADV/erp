'use client'

import { useEffect, useMemo, useState } from 'react'
import { Edit, FileText, Plus, Trash2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { usePermissionsContext } from '@/lib/contexts/permissions-context'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CommandSelect } from '@/components/ui/command-select'
import { DatePicker } from '@/components/ui/date-picker'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { Table } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/toast'
import { formatContratoDisplay } from '@/lib/utils/contrato-display'
import { openTimesheetReport } from '@/lib/utils/timesheet-report'
import { TIMESHEET_TEMPLATES } from './timesheet-templates'

type TimesheetStatus = 'em_lancamento' | 'revisao' | 'aprovado'

function canEditTimesheetInList(status: string) {
  return status === 'em_lancamento' || status === 'revisao'
}

interface TimesheetItem {
  id: string
  contrato_id: string
  contrato_numero: number | null
  contrato_nome: string
  caso_id: string
  caso_numero: number | null
  caso_nome: string
  data_lancamento: string
  horas: string
  duracao_minutos?: number | null
  descricao: string
  status: TimesheetStatus
  ia_auxiliado?: boolean | null
  ia_minutos?: number | null
  created_by: string
  created_by_nome: string | null
}

interface ContratoItem {
  id: string
  numero?: number
  numero_sequencial?: number | null
  cliente_id?: string
  cliente_nome?: string
  nome_contrato: string
  status?: string
  casos?: Array<{ id: string; numero?: number; nome: string }>
}

interface FormState {
  id?: string
  cliente_id: string
  contrato_id: string
  caso_id: string
  data_lancamento: string
  horas_componente: string
  minutos_componente: string
  descricao: string
  // "Auxiliado por IA" — registrado na origem, oculto nas etapas posteriores.
  ia_auxiliado: boolean
  ia_horas_componente: string
  ia_minutos_componente: string
}

const emptyForm: FormState = {
  cliente_id: '',
  contrato_id: '',
  caso_id: '',
  data_lancamento: '',
  horas_componente: '0',
  minutos_componente: '0',
  descricao: '',
  ia_auxiliado: false,
  ia_horas_componente: '0',
  ia_minutos_componente: '0',
}

function toMinutes(horas: string | number | null | undefined) {
  const parsed = Number(horas || 0)
  if (Number.isNaN(parsed)) return '0'
  return String(Math.round(parsed * 60))
}

function toHoursFromMinutes(minutos: number | string) {
  const parsed = Number(minutos || 0)
  if (Number.isNaN(parsed) || parsed < 0) return '0'
  return String((parsed / 60).toFixed(2))
}

function splitMinutosTotal(total: number | string | null | undefined) {
  const parsed = Number(total || 0)
  if (Number.isNaN(parsed) || parsed < 0) return { horas: '0', minutos: '0' }
  const inteiro = Math.floor(parsed)
  return { horas: String(Math.floor(inteiro / 60)), minutos: String(inteiro % 60) }
}

// Exibe uma duração (em minutos) como "2h30min" / "2h" / "45min" (padrão do mock).
function formatDuracao(totalMinutos: number | string | null | undefined) {
  const parsed = Math.max(0, Math.floor(Number(totalMinutos || 0)))
  const h = Math.floor(parsed / 60)
  const m = parsed % 60
  if (h && m) return `${h}h${String(m).padStart(2, '0')}min`
  if (h) return `${h}h`
  return `${m}min`
}

const MESES_CURTOS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

function computeMinutosTotal(horas: string, minutos: string) {
  const h = Math.max(0, Math.floor(Number(horas || 0)))
  const mRaw = Math.max(0, Math.floor(Number(minutos || 0)))
  const m = Math.min(mRaw, 60)
  return h * 60 + m
}

function applyTemplatePlaceholders(
  template: string,
  context: { cliente?: string; contrato?: string; caso?: string },
) {
  return template
    .replaceAll('[Cliente]', context.cliente || 'cliente')
    .replaceAll('[nome do cliente]', context.cliente || 'cliente')
    .replaceAll('[cliente]', context.cliente || 'cliente')
    .replaceAll('[contrato]', context.contrato || 'contrato')
    .replaceAll('[caso]', context.caso || 'caso')
}

export default function TimesheetList() {
  const { hasPermission } = usePermissionsContext()
  const { success, error: toastError } = useToast()

  const canRead = hasPermission('operations.timesheet.read')
  const canWrite = hasPermission('operations.timesheet.write')

  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [items, setItems] = useState<TimesheetItem[]>([])
  const [contratos, setContratos] = useState<ContratoItem[]>([])

  const [filterClienteId, setFilterClienteId] = useState('')
  const [filterCasoId, setFilterCasoId] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  // Período: ano + mês em chips (mock do cliente); mês null = ano inteiro.
  const [filterAno, setFilterAno] = useState(() => new Date().getFullYear())
  const [filterMes, setFilterMes] = useState<number | null>(() => new Date().getMonth())

  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [templateCategoria, setTemplateCategoria] = useState('')
  const [templateSelecionadoId, setTemplateSelecionadoId] = useState('')

  const getSession = async () => {
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    return session
  }

  const getFunctionsHeaders = (accessToken: string) => {
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    return {
      Authorization: `Bearer ${accessToken}`,
      ...(anonKey ? { apikey: anonKey } : {}),
      'Content-Type': 'application/json',
    }
  }

  const contratoOptions = useMemo(
    () =>
      contratos.map((item) => ({
        value: item.id,
        label: formatContratoDisplay(item.numero_sequencial ?? item.numero, item.nome_contrato).full,
      })),
    [contratos],
  )

  const clienteOptions = useMemo(() => {
    const unique = new Map<string, string>()
    for (const contrato of contratos) {
      if (!contrato.cliente_id) continue
      if (!unique.has(contrato.cliente_id)) {
        unique.set(contrato.cliente_id, contrato.cliente_nome || 'Cliente sem nome')
      }
    }
    return Array.from(unique.entries()).map(([value, label]) => ({ value, label }))
  }, [contratos])

  const casosFromCliente = useMemo(() => {
    if (!form.cliente_id) return [] as Array<{ id: string; numero?: number; nome: string; contrato_id: string; contrato_nome: string; contrato_numero?: number }>
    return contratos
      .filter((c) => c.cliente_id === form.cliente_id)
      .flatMap((contrato) =>
        (contrato.casos || []).map((caso) => ({
          ...caso,
          contrato_id: contrato.id,
          contrato_nome: contrato.nome_contrato,
          contrato_numero: contrato.numero,
        })),
      )
  }, [contratos, form.cliente_id])

  const filterCaseOptions = useMemo(() => {
    const fonte = filterClienteId ? contratos.filter((c) => c.cliente_id === filterClienteId) : contratos
    return fonte.flatMap((c) =>
      (c.casos || []).map((caso) => ({
        value: caso.id,
        label: `${caso.numero || '-'} - ${caso.nome}`,
      })),
    )
  }, [contratos, filterClienteId])

  // Nome do cliente por contrato para a coluna Cliente e o filtro client-side.
  const contratoInfo = useMemo(() => {
    const m = new Map<string, { cliente_id?: string; cliente_nome?: string }>()
    for (const c of contratos) m.set(c.id, { cliente_id: c.cliente_id, cliente_nome: c.cliente_nome })
    return m
  }, [contratos])

  const formCasoOptions = useMemo(
    () =>
      casosFromCliente.map((caso) => ({
        value: caso.id,
        label: `${caso.numero || '-'} - ${caso.nome}`,
      })),
    [casosFromCliente],
  )

  const templateCategoriaOptions = useMemo(() => {
    const categorias = Array.from(new Set(TIMESHEET_TEMPLATES.map((item) => item.categoria)))
    return [{ value: '', label: 'Todas as categorias' }, ...categorias.map((categoria) => ({ value: categoria, label: categoria }))]
  }, [])

  const templateOptions = useMemo(() => {
    return TIMESHEET_TEMPLATES
      .filter((item) => !templateCategoria || item.categoria === templateCategoria)
      .map((item) => ({ value: item.id, label: `${item.categoria} - ${item.texto}` }))
  }, [templateCategoria])

  // Filtro por cliente é client-side (a edge filtra por caso/status/período).
  const visibleItems = useMemo(() => {
    if (!filterClienteId) return items
    return items.filter((it) => contratoInfo.get(it.contrato_id)?.cliente_id === filterClienteId)
  }, [items, filterClienteId, contratoInfo])

  // Agrupamento cronológico por dia (mais recente no topo), estilo Despesas.
  const groupedByDay = useMemo(() => {
    const g = new Map<string, TimesheetItem[]>()
    for (const it of visibleItems) {
      const d = it.data_lancamento || ''
      if (!g.has(d)) g.set(d, [])
      g.get(d)!.push(it)
    }
    return Array.from(g.entries()).sort((a, b) => b[0].localeCompare(a[0]))
  }, [visibleItems])

  // "QUA., 15 DE JUL." (mock do cliente)
  const fmtDia = (d: string) => {
    if (!d) return '—'
    const dt = new Date(d + 'T12:00:00')
    return dt.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' }).replaceAll('.', '')
  }

  const anoOptions = useMemo(() => {
    const atual = new Date().getFullYear()
    return [atual - 2, atual - 1, atual, atual + 1]
  }, [])

  const statusOptions = [
    { value: '', label: 'Todos os status' },
    { value: 'em_lancamento', label: 'Em lançamento' },
    { value: 'revisao', label: 'Revisão' },
    { value: 'aprovado', label: 'Aprovado' },
  ]

  const fetchContratos = async () => {
    const session = await getSession()
    if (!session) return

    const noCacheUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-contratos?_ts=${Date.now()}`
    const response = await fetch(noCacheUrl, {
      method: 'GET',
      cache: 'no-store',
      headers: {
        ...getFunctionsHeaders(session.access_token),
      },
    })

    const payload = await response.json()
    if (!response.ok) return
    const contratosAtivos = ((payload.data || []) as ContratoItem[]).filter((contrato) => contrato.status === 'ativo')
    setContratos(contratosAtivos)
  }

  const fetchTimesheets = async () => {
    try {
      setLoading(true)
      setError(null)
      const session = await getSession()
      if (!session) return

      const params = new URLSearchParams()
      if (filterCasoId) params.set('caso_id', filterCasoId)
      if (filterStatus) params.set('status', filterStatus)
      if (filterMes != null) {
        const mm = String(filterMes + 1).padStart(2, '0')
        const ultimoDia = new Date(filterAno, filterMes + 1, 0).getDate()
        params.set('data_inicio', `${filterAno}-${mm}-01`)
        params.set('data_fim', `${filterAno}-${mm}-${String(ultimoDia).padStart(2, '0')}`)
      } else {
        params.set('data_inicio', `${filterAno}-01-01`)
        params.set('data_fim', `${filterAno}-12-31`)
      }
      params.set('_ts', String(Date.now()))

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-timesheets?${params.toString()}`,
        {
          method: 'GET',
          cache: 'no-store',
          headers: {
            ...getFunctionsHeaders(session.access_token),
          },
        },
      )

      const payload = await response.json()
      if (!response.ok) {
        setError(payload.error || 'Erro ao carregar timesheets')
        return
      }

      setItems((payload.data || []) as TimesheetItem[])
    } catch (err) {
      console.error(err)
      setError('Erro ao carregar timesheets')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!canRead) return
    void fetchContratos()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canRead])

  useEffect(() => {
    if (!canRead) return
    void fetchTimesheets()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canRead, filterCasoId, filterStatus, filterAno, filterMes])

  useEffect(() => {
    if (!filterClienteId || !filterCasoId) return
    const hasCaso = filterCaseOptions.some((opt) => opt.value === filterCasoId)
    if (!hasCaso) setFilterCasoId('')
  }, [filterCaseOptions, filterClienteId, filterCasoId])

  useEffect(() => {
    if (!form.cliente_id || !form.caso_id) return
    const selectedCase = casosFromCliente.find((item) => item.id === form.caso_id)
    if (!selectedCase) {
      setForm((prev) => ({ ...prev, caso_id: '', contrato_id: '' }))
    }
  }, [casosFromCliente, form.caso_id, form.cliente_id])

  const openCreate = () => {
    setForm({ ...emptyForm, data_lancamento: new Date().toISOString().slice(0, 10) })
    setTemplateCategoria('')
    setTemplateSelecionadoId('')
    setDialogOpen(true)
  }

  // Botão "+ Novo timesheet" do header da página (acima das abas) abre o mesmo dialog.
  useEffect(() => {
    if (!canWrite) return
    const onNovo = () => openCreate()
    window.addEventListener('vlma:novo-timesheet', onNovo)
    return () => window.removeEventListener('vlma:novo-timesheet', onNovo)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canWrite])

  const openEdit = (item: TimesheetItem) => {
    const contrato = contratos.find((c) => c.id === item.contrato_id)
    const totalMinutos = item.duracao_minutos != null ? Number(item.duracao_minutos) : Number(toMinutes(item.horas))
    const split = splitMinutosTotal(totalMinutos)
    const iaSplit = splitMinutosTotal(item.ia_minutos ?? 0)
    setForm({
      id: item.id,
      cliente_id: contrato?.cliente_id || '',
      contrato_id: item.contrato_id,
      caso_id: item.caso_id,
      data_lancamento: item.data_lancamento,
      horas_componente: split.horas,
      minutos_componente: split.minutos,
      descricao: item.descricao || '',
      ia_auxiliado: Boolean(item.ia_auxiliado),
      ia_horas_componente: iaSplit.horas,
      ia_minutos_componente: iaSplit.minutos,
    })
    setTemplateCategoria('')
    setTemplateSelecionadoId('')
    setDialogOpen(true)
  }

  const deleteTimesheet = async (item: TimesheetItem) => {
    const ok = window.confirm(
      `Excluir este lançamento de timesheet?\n\n${item.contrato_nome || ''} — ${item.caso_nome || ''}\n${item.descricao || ''}\n\nEsta ação não pode ser desfeita.`,
    )
    if (!ok) return

    try {
      setSubmitting(true)
      const session = await getSession()
      if (!session) return

      const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/delete-timesheet`, {
        method: 'POST',
        headers: { ...getFunctionsHeaders(session.access_token) },
        body: JSON.stringify({ id: item.id }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        toastError(payload.error || 'Erro ao excluir timesheet')
        return
      }

      success('Lançamento excluído')
      window.dispatchEvent(new Event('vlma:timesheet-changed'))
      await fetchTimesheets()
    } catch (err) {
      console.error(err)
      toastError('Erro ao excluir timesheet')
    } finally {
      setSubmitting(false)
    }
  }

  const saveTimesheet = async () => {
    if (!form.cliente_id || !form.contrato_id || !form.caso_id) {
      toastError('Cliente, caso e contrato são obrigatórios')
      return
    }

    const minutos = computeMinutosTotal(form.horas_componente, form.minutos_componente)
    if (minutos <= 0) {
      toastError('Informe a duração do lançamento (horas e/ou minutos)')
      return
    }

    const iaMinutos = form.ia_auxiliado
      ? computeMinutosTotal(form.ia_horas_componente, form.ia_minutos_componente)
      : 0
    if (form.ia_auxiliado && iaMinutos <= 0) {
      toastError('Informe quanto tempo foi auxiliado por IA')
      return
    }

    try {
      setSubmitting(true)
      const session = await getSession()
      if (!session) return

      const endpoint = form.id ? 'update-timesheet' : 'create-timesheet'
      const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/${endpoint}`, {
        method: 'POST',
        headers: {
          ...getFunctionsHeaders(session.access_token),
        },
        body: JSON.stringify({
          id: form.id,
          contrato_id: form.contrato_id,
          caso_id: form.caso_id,
          data_lancamento: form.data_lancamento,
          horas: toHoursFromMinutes(minutos),
          duracao_minutos: minutos,
          descricao: form.descricao,
          ia_auxiliado: form.ia_auxiliado,
          ia_minutos: form.ia_auxiliado ? iaMinutos : null,
        }),
      })

      const payload = await response.json()
      if (!response.ok) {
        toastError(payload.error || 'Erro ao salvar timesheet')
        return
      }

      success(form.id ? 'Timesheet atualizado' : 'Timesheet criado')
      window.dispatchEvent(new Event('vlma:timesheet-changed'))
      setDialogOpen(false)
      setForm(emptyForm)
      setTemplateCategoria('')
      setTemplateSelecionadoId('')
      await fetchTimesheets()
    } catch (err) {
      console.error(err)
      toastError('Erro ao salvar timesheet')
    } finally {
      setSubmitting(false)
    }
  }

  if (!canRead) {
    return (
      <Alert className="border border-destructive/30 bg-destructive/10 text-destructive">
        <AlertTitle>Atenção</AlertTitle>
        <AlertDescription>Você não tem permissão para visualizar timesheets.</AlertDescription>
      </Alert>
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

      <div className="flex flex-wrap items-center gap-2">
        {canWrite ? (
          <Button onClick={openCreate} className="rounded-full">
            <Plus className="mr-2 h-4 w-4" />
            Novo timesheet
          </Button>
        ) : null}
        <Button
          variant="outline"
          className="rounded-full"
          disabled={visibleItems.length === 0}
          onClick={() =>
            openTimesheetReport({
              titulo: 'Relatório de timesheet',
              subtitulo: filterMes != null ? `${MESES_CURTOS[filterMes]}/${filterAno}` : String(filterAno),
              rows: visibleItems.map((it) => ({
                data: it.data_lancamento ? it.data_lancamento.split('-').reverse().join('/') : '',
                cliente: contratoInfo.get(it.contrato_id)?.cliente_nome || it.contrato_nome || '',
                caso: `${it.caso_numero || ''} - ${it.caso_nome}`,
                profissional: it.created_by_nome || '',
                descricao: it.descricao || '',
                horas: formatDuracao(it.duracao_minutos != null ? it.duracao_minutos : Number(toMinutes(it.horas))),
              })),
            })
          }
        >
          <FileText className="mr-2 h-4 w-4" />
          Gerar relatório
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <CommandSelect
          value={filterClienteId}
          onValueChange={(value) => {
            setFilterClienteId(value)
          }}
          options={clienteOptions}
          placeholder="Todos os clientes"
          searchPlaceholder="Buscar cliente..."
          emptyText="Nenhum cliente"
        />

        <CommandSelect
          value={filterCasoId}
          onValueChange={setFilterCasoId}
          options={filterCaseOptions}
          placeholder="Todos os casos"
          searchPlaceholder="Buscar caso..."
          emptyText="Nenhum caso"
        />

        <CommandSelect
          value={filterStatus}
          onValueChange={setFilterStatus}
          options={statusOptions}
          placeholder="Todos os status"
        />
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <NativeSelect
          value={String(filterAno)}
          onChange={(e) => setFilterAno(Number(e.target.value))}
          className="h-8 w-auto rounded-full border px-3 text-sm"
        >
          {anoOptions.map((ano) => (
            <option key={ano} value={ano}>{ano}</option>
          ))}
        </NativeSelect>
        <span className="px-1 text-ink-mute" aria-hidden>→</span>
        {MESES_CURTOS.map((mes, i) => (
          <button
            key={mes}
            type="button"
            onClick={() => setFilterMes((prev) => (prev === i ? null : i))}
            className={`rounded-full px-3 py-1 text-sm transition ${
              filterMes === i
                ? 'bg-[#E8871E] font-medium text-white'
                : 'text-ink-secondary hover:bg-canvas-soft'
            }`}
            title={filterMes === i ? 'Clique para ver o ano inteiro' : undefined}
          >
            {mes}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-md border">
        <Table className="w-full min-w-full">
          <thead className="bg-canvas-soft">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-ink-mute">Cliente</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-ink-mute">Caso</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-ink-mute">Descrição</th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase text-ink-mute">Tempo</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-ink-mute">Lançado por</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-ink-mute">Ações</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-ink-mute">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline bg-white">
            {loading ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-muted-foreground">Carregando...</td>
              </tr>
            ) : visibleItems.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-muted-foreground">Nenhum timesheet encontrado.</td>
              </tr>
            ) : (
              groupedByDay.flatMap(([dia, linhas]) => [
                <tr key={`sep-${dia}`} className="bg-amber-50/70">
                  <td colSpan={7} className="px-4 py-1.5 text-xs font-semibold uppercase text-ink-secondary">
                    {fmtDia(dia)} · {formatDuracao(linhas.reduce((s, it) => s + (it.duracao_minutos ?? Math.round(Number(it.horas || 0) * 60)), 0))}
                  </td>
                </tr>,
                ...linhas.map((item) => {
                const statusUpper =
                  item.status === 'aprovado'
                    ? { label: 'APROVADO', cls: 'border-emerald-200 bg-emerald-100 text-emerald-700' }
                    : item.status === 'revisao'
                      ? { label: 'EM REVISÃO', cls: 'border-amber-200 bg-amber-100 text-amber-700' }
                      : { label: 'EM LANÇAMENTO', cls: 'border-blue-200 bg-blue-100 text-blue-700' }
                const showEdit = canWrite && canEditTimesheetInList(item.status)
                const clienteNome = contratoInfo.get(item.contrato_id)?.cliente_nome || item.contrato_nome || '-'
                const autorNome = item.created_by_nome || '-'
                const autorIniciais = autorNome
                  .split(/\s+/)
                  .filter(Boolean)
                  .slice(0, 2)
                  .map((p) => p[0]?.toUpperCase() || '')
                  .join('') || '?'

                return (
                  <tr key={item.id}>
                    <td className="max-w-[200px] px-4 py-3 text-sm font-medium text-ink">{clienteNome}</td>
                    <td className="max-w-[220px] px-4 py-3 text-sm text-ink-secondary">{item.caso_numero || '-'} - {item.caso_nome}</td>
                    <td className="px-4 py-3 text-sm text-ink-secondary">{item.descricao || '-'}</td>
                    <td className="px-4 py-3 text-right text-sm font-semibold font-tabular text-ink">{formatDuracao(item.duracao_minutos != null ? item.duracao_minutos : Number(toMinutes(item.horas)))}</td>
                    <td className="px-4 py-3 text-sm">
                      <span className="inline-flex items-center gap-2">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-100 text-[9px] font-semibold text-amber-700">
                          {autorIniciais}
                        </span>
                        <span className="text-ink-secondary">{autorNome}</span>
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        {showEdit ? (
                          <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => openEdit(item)} title="Editar lançamento">
                            <Edit className="h-3.5 w-3.5" />
                          </Button>
                        ) : null}
                        {showEdit ? (
                          <Button
                            size="icon"
                            variant="outline"
                            className="h-8 w-8 text-red-600 hover:bg-red-50 hover:text-red-700"
                            onClick={() => void deleteTimesheet(item)}
                            disabled={submitting}
                            title="Excluir lançamento"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge className={`whitespace-nowrap text-[10px] ${statusUpper.cls}`}>{statusUpper.label}</Badge>
                    </td>
                  </tr>
                )
              })])
            )}
          </tbody>
        </Table>
      </div>

      <Dialog open={dialogOpen} onOpenChange={(open) => !submitting && setDialogOpen(open)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{form.id ? 'Editar timesheet' : 'Novo timesheet'}</DialogTitle>
          </DialogHeader>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2 md:col-span-2">
              <Label>Cliente</Label>
              <CommandSelect
                value={form.cliente_id}
                onValueChange={(value) =>
                  setForm((prev) => ({ ...prev, cliente_id: value, caso_id: '', contrato_id: '' }))
                }
                options={clienteOptions}
                placeholder="Selecione o cliente"
                searchPlaceholder="Buscar cliente..."
                emptyText="Nenhum cliente"
              />
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label>Caso</Label>
              <CommandSelect
                value={form.caso_id}
                onValueChange={(value) => {
                  const selected = casosFromCliente.find((item) => item.id === value)
                  setForm((prev) => ({
                    ...prev,
                    caso_id: value,
                    contrato_id: selected?.contrato_id || '',
                  }))
                }}
                options={formCasoOptions}
                placeholder="Selecione o caso"
                searchPlaceholder="Buscar caso..."
                emptyText="Nenhum caso para o cliente"
                disabled={!form.cliente_id}
              />
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label>Contrato (preenchido automaticamente)</Label>
              <Input
                readOnly
                value={
                  contratoOptions.find((item) => item.value === form.contrato_id)?.label || ''
                }
                placeholder="Selecione cliente e caso"
              />
            </div>

            <div className="space-y-2">
              <Label>Data de lançamento</Label>
              <DatePicker
                value={form.data_lancamento}
                onChange={(value) => setForm((prev) => ({ ...prev, data_lancamento: value }))}
              />
            </div>

            <div className="space-y-2">
              <Label>Duração</Label>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Input
                    type="number"
                    step="1"
                    min="0"
                    value={form.horas_componente}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, horas_componente: event.target.value }))
                    }
                    placeholder="Horas"
                    aria-label="Horas"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">Horas</p>
                </div>
                <div>
                  <Input
                    type="number"
                    step="1"
                    min="0"
                    max="60"
                    value={form.minutos_componente}
                    onChange={(event) => {
                      const raw = event.target.value
                      const numeric = Number(raw)
                      const clamped = Number.isFinite(numeric) ? Math.min(Math.max(numeric, 0), 60) : 0
                      setForm((prev) => ({
                        ...prev,
                        minutos_componente: raw === '' ? '' : String(clamped),
                      }))
                    }}
                    placeholder="Minutos"
                    aria-label="Minutos"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">Minutos (0 a 60)</p>
                </div>
              </div>
            </div>

            <div className="space-y-2 md:col-span-2 rounded-lg border border-hairline bg-canvas-soft/60 p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <Label>Auxiliado por IA?</Label>
                  <p className="text-xs text-ink-mute">Registro interno para medição — não aparece na revisão nem na fatura.</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={form.ia_auxiliado}
                  onClick={() => setForm((prev) => ({ ...prev, ia_auxiliado: !prev.ia_auxiliado }))}
                  className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${form.ia_auxiliado ? 'bg-[#E8871E]' : 'bg-gray-300'}`}
                >
                  <span
                    className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${form.ia_auxiliado ? 'left-[22px]' : 'left-0.5'}`}
                  />
                </button>
              </div>
              {form.ia_auxiliado ? (
                <div>
                  <Label className="text-xs">Quanto tempo?</Label>
                  <div className="mt-1 grid grid-cols-2 gap-2">
                    <div>
                      <Input
                        type="number"
                        step="1"
                        min="0"
                        value={form.ia_horas_componente}
                        onChange={(event) =>
                          setForm((prev) => ({ ...prev, ia_horas_componente: event.target.value }))
                        }
                        placeholder="Horas"
                        aria-label="Horas auxiliadas por IA"
                      />
                      <p className="mt-1 text-xs text-muted-foreground">Horas</p>
                    </div>
                    <div>
                      <Input
                        type="number"
                        step="1"
                        min="0"
                        max="60"
                        value={form.ia_minutos_componente}
                        onChange={(event) => {
                          const raw = event.target.value
                          const numeric = Number(raw)
                          const clamped = Number.isFinite(numeric) ? Math.min(Math.max(numeric, 0), 60) : 0
                          setForm((prev) => ({
                            ...prev,
                            ia_minutos_componente: raw === '' ? '' : String(clamped),
                          }))
                        }}
                        placeholder="Minutos"
                        aria-label="Minutos auxiliados por IA"
                      />
                      <p className="mt-1 text-xs text-muted-foreground">Minutos (0 a 60)</p>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label>Template de descritivo</Label>
              <div className="grid gap-2 md:grid-cols-2">
                <CommandSelect
                  value={templateCategoria}
                  onValueChange={(value) => {
                    setTemplateCategoria(value)
                    setTemplateSelecionadoId('')
                  }}
                  options={templateCategoriaOptions}
                  placeholder="Filtrar por categoria"
                  searchPlaceholder="Buscar categoria..."
                  emptyText="Nenhuma categoria"
                />
                <CommandSelect
                  value={templateSelecionadoId}
                  onValueChange={(value) => {
                    setTemplateSelecionadoId(value)
                    const selectedTemplate = TIMESHEET_TEMPLATES.find((item) => item.id === value)
                    if (!selectedTemplate) return
                    const selectedContrato = contratos.find((item) => item.id === form.contrato_id)
                    const selectedCaso = casosFromCliente.find((item) => item.id === form.caso_id)
                    const descricaoTemplate = applyTemplatePlaceholders(selectedTemplate.texto, {
                      cliente: selectedContrato?.cliente_nome,
                      contrato: selectedContrato?.nome_contrato,
                      caso: selectedCaso?.nome,
                    })
                    setForm((prev) => ({ ...prev, descricao: descricaoTemplate }))
                  }}
                  options={templateOptions}
                  placeholder="Escolha um template"
                  searchPlaceholder="Buscar por categoria ou texto..."
                  emptyText="Nenhum template"
                />
              </div>
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label>Descrição</Label>
              <Textarea
                value={form.descricao}
                onChange={(event) => setForm((prev) => ({ ...prev, descricao: event.target.value }))}
                rows={4}
                placeholder="Descreva o trabalho realizado"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={submitting}>
              Cancelar
            </Button>
            <Button onClick={saveTimesheet} disabled={submitting}>
              {submitting ? 'Salvando...' : 'Salvar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
