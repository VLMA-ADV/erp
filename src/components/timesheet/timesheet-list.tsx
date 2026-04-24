'use client'

import { useEffect, useMemo, useState } from 'react'
import { Edit, Plus } from 'lucide-react'
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
import { Table } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/toast'
import { TIMESHEET_TEMPLATES } from './timesheet-templates'

type TimesheetStatus = 'em_lancamento' | 'revisao' | 'aprovado'

const TIMESHEET_STATUS_LABEL: Record<TimesheetStatus, string> = {
  em_lancamento: 'Em lançamento',
  revisao: 'Em revisão (faturamento)',
  aprovado: 'Aprovado',
}

function timesheetStatusLabel(status: string): string {
  if (status === 'em_lancamento' || status === 'revisao' || status === 'aprovado') {
    return TIMESHEET_STATUS_LABEL[status]
  }
  return status || '—'
}

function canEditTimesheetInList(status: string) {
  return status === 'em_lancamento' || status === 'aprovado'
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
  created_by: string
  created_by_nome: string | null
}

interface ContratoItem {
  id: string
  numero?: number
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
  minutos: string
  descricao: string
}

const emptyForm: FormState = {
  cliente_id: '',
  contrato_id: '',
  caso_id: '',
  data_lancamento: '',
  minutos: '0',
  descricao: '',
}

function toMinutes(horas: string | number | null | undefined) {
  const parsed = Number(horas || 0)
  if (Number.isNaN(parsed)) return '0'
  return String(Math.round(parsed * 60))
}

function toHoursFromMinutes(minutos: string) {
  const parsed = Number(minutos || 0)
  if (Number.isNaN(parsed) || parsed < 0) return '0'
  return String((parsed / 60).toFixed(2))
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

  const [filterContratoId, setFilterContratoId] = useState('')
  const [filterCasoId, setFilterCasoId] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterDataInicio, setFilterDataInicio] = useState('')
  const [filterDataFim, setFilterDataFim] = useState('')

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
    () => contratos.map((item) => ({ value: item.id, label: `${item.numero || '-'} - ${item.nome_contrato}` })),
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
    if (!filterContratoId) {
      return contratos.flatMap((c) =>
        (c.casos || []).map((caso) => ({
          value: caso.id,
          label: `${caso.numero || '-'} - ${caso.nome} (${c.numero || '-'} - ${c.nome_contrato})`,
        })),
      )
    }

    const contrato = contratos.find((c) => c.id === filterContratoId)
    return (contrato?.casos || []).map((caso) => ({
      value: caso.id,
      label: `${caso.numero || '-'} - ${caso.nome}`,
    }))
  }, [contratos, filterContratoId])

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
      if (filterContratoId) params.set('contrato_id', filterContratoId)
      if (filterCasoId) params.set('caso_id', filterCasoId)
      if (filterStatus) params.set('status', filterStatus)
      if (filterDataInicio) params.set('data_inicio', filterDataInicio)
      if (filterDataFim) params.set('data_fim', filterDataFim)
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
  }, [canRead, filterContratoId, filterCasoId, filterStatus, filterDataInicio, filterDataFim])

  useEffect(() => {
    if (!filterContratoId) return
    const contrato = contratos.find((c) => c.id === filterContratoId)
    const hasCaso = (contrato?.casos || []).some((caso) => caso.id === filterCasoId)
    if (!hasCaso) setFilterCasoId('')
  }, [contratos, filterContratoId, filterCasoId])

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

  const openEdit = (item: TimesheetItem) => {
    const contrato = contratos.find((c) => c.id === item.contrato_id)
    setForm({
      id: item.id,
      cliente_id: contrato?.cliente_id || '',
      contrato_id: item.contrato_id,
      caso_id: item.caso_id,
      data_lancamento: item.data_lancamento,
      minutos: item.duracao_minutos != null ? String(item.duracao_minutos) : toMinutes(item.horas),
      descricao: item.descricao || '',
    })
    setTemplateCategoria('')
    setTemplateSelecionadoId('')
    setDialogOpen(true)
  }

  const saveTimesheet = async () => {
    if (!form.cliente_id || !form.contrato_id || !form.caso_id) {
      toastError('Cliente, caso e contrato são obrigatórios')
      return
    }

    const minutos = Number(form.minutos || 0)
    if (Number.isNaN(minutos) || minutos <= 0) {
      toastError('Informe os minutos do lançamento')
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
          horas: toHoursFromMinutes(form.minutos),
          duracao_minutos: minutos,
          descricao: form.descricao,
        }),
      })

      const payload = await response.json()
      if (!response.ok) {
        toastError(payload.error || 'Erro ao salvar timesheet')
        return
      }

      success(form.id ? 'Timesheet atualizado' : 'Timesheet criado')
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
      <Alert className="border-red-200 bg-red-50 text-red-700">
        <AlertTitle>Atenção</AlertTitle>
        <AlertDescription>Você não tem permissão para visualizar timesheets.</AlertDescription>
      </Alert>
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

      <div className="grid gap-3 md:grid-cols-4">
        {canWrite ? (
          <Button onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" />
            Novo lançamento
          </Button>
        ) : null}

        <CommandSelect
          value={filterContratoId}
          onValueChange={(value) => {
            setFilterContratoId(value)
            setFilterCasoId('')
          }}
          options={contratoOptions}
          placeholder="Filtrar por contrato"
          searchPlaceholder="Buscar contrato..."
          emptyText="Nenhum contrato"
        />

        <CommandSelect
          value={filterCasoId}
          onValueChange={setFilterCasoId}
          options={filterCaseOptions}
          placeholder="Filtrar por caso"
          searchPlaceholder="Buscar caso..."
          emptyText="Nenhum caso"
        />

        <CommandSelect
          value={filterStatus}
          onValueChange={setFilterStatus}
          options={statusOptions}
          placeholder="Status"
        />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1">
          <Label>Data inicial</Label>
          <DatePicker value={filterDataInicio} onChange={setFilterDataInicio} />
        </div>
        <div className="space-y-1">
          <Label>Data final</Label>
          <DatePicker value={filterDataFim} onChange={setFilterDataFim} />
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <Table className="w-full min-w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Data</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Contrato/Caso</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Minutos</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Status</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Lançado por</th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase text-gray-500">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-muted-foreground">Carregando...</td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-muted-foreground">Nenhum timesheet encontrado.</td>
              </tr>
            ) : (
              items.map((item) => {
                const statusClassName =
                  item.status === 'aprovado'
                    ? 'border-green-200 bg-green-100 text-green-700'
                    : item.status === 'revisao'
                      ? 'border-yellow-200 bg-yellow-100 text-yellow-700'
                      : 'border-blue-200 bg-blue-100 text-blue-700'
                const showEdit = canWrite && canEditTimesheetInList(item.status)

                return (
                  <tr key={item.id}>
                    <td className="px-4 py-3 text-sm">{item.data_lancamento ? new Date(item.data_lancamento).toLocaleDateString('pt-BR') : '-'}</td>
                    <td className="px-4 py-3 text-sm">
                      <p className="font-medium">{item.contrato_numero || '-'} - {item.contrato_nome}</p>
                      <p className="text-muted-foreground">{item.caso_numero || '-'} - {item.caso_nome}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{item.descricao || '-'}</p>
                    </td>
                    <td className="px-4 py-3 text-sm">{item.duracao_minutos != null ? String(item.duracao_minutos) : toMinutes(item.horas)}</td>
                    <td className="px-4 py-3 text-sm">
                      <Badge className={statusClassName}>{timesheetStatusLabel(item.status)}</Badge>
                    </td>
                    <td className="px-4 py-3 text-sm">{item.created_by_nome || '-'}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {showEdit ? (
                          <Button size="icon" variant="ghost" onClick={() => openEdit(item)}>
                            <Edit className="h-4 w-4" />
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                )
              })
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
              <Label>Minutos</Label>
              <Input
                type="number"
                step="1"
                min="0"
                value={form.minutos}
                onChange={(event) => setForm((prev) => ({ ...prev, minutos: event.target.value }))}
                placeholder="Ex: 90"
              />
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
