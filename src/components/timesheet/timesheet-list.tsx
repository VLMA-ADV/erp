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

type TimesheetStatus = 'em_lancamento' | 'revisao' | 'aprovado'

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
  descricao: string
  status: TimesheetStatus
  created_by: string
  created_by_nome: string | null
}

interface ContratoItem {
  id: string
  numero?: number
  nome_contrato: string
  status?: string
  casos?: Array<{ id: string; numero?: number; nome: string }>
}

interface FormState {
  id?: string
  contrato_id: string
  caso_id: string
  data_lancamento: string
  horas: string
  descricao: string
}

const emptyForm: FormState = {
  contrato_id: '',
  caso_id: '',
  data_lancamento: '',
  horas: '0',
  descricao: '',
}

export default function TimesheetList() {
  const { hasPermission } = usePermissionsContext()
  const { success, error: toastError } = useToast()

  const canRead = hasPermission('operations.timesheet.read') || hasPermission('operations.timesheet.*') || hasPermission('operations.*')
  const canWrite = hasPermission('operations.timesheet.write') || hasPermission('operations.timesheet.*') || hasPermission('operations.*')

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

  const getSession = async () => {
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    return session
  }

  const contratoOptions = useMemo(
    () => contratos.map((item) => ({ value: item.id, label: `${item.numero || '-'} - ${item.nome_contrato}` })),
    [contratos],
  )

  const casosFromContrato = useMemo(() => {
    if (!form.contrato_id) return [] as Array<{ id: string; numero?: number; nome: string }>
    return contratos.find((c) => c.id === form.contrato_id)?.casos || []
  }, [contratos, form.contrato_id])

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
    () => casosFromContrato.map((caso) => ({ value: caso.id, label: `${caso.numero || '-'} - ${caso.nome}` })),
    [casosFromContrato],
  )

  const statusOptions = [
    { value: '', label: 'Todos os status' },
    { value: 'em_lancamento', label: 'Em lançamento' },
    { value: 'revisao', label: 'Revisão' },
    { value: 'aprovado', label: 'Aprovado' },
  ]

  const fetchContratos = async () => {
    const session = await getSession()
    if (!session) return

    const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-contratos`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
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

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-timesheets?${params.toString()}`,
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

  const openCreate = () => {
    setForm({ ...emptyForm, data_lancamento: new Date().toISOString().slice(0, 10) })
    setDialogOpen(true)
  }

  const openEdit = (item: TimesheetItem) => {
    setForm({
      id: item.id,
      contrato_id: item.contrato_id,
      caso_id: item.caso_id,
      data_lancamento: item.data_lancamento,
      horas: String(item.horas || '0'),
      descricao: item.descricao || '',
    })
    setDialogOpen(true)
  }

  const saveTimesheet = async () => {
    if (!form.contrato_id || !form.caso_id) {
      toastError('Contrato e caso são obrigatórios')
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
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id: form.id,
          contrato_id: form.contrato_id,
          caso_id: form.caso_id,
          data_lancamento: form.data_lancamento,
          horas: form.horas,
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

        {canWrite ? (
          <Button onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" />
            Novo lançamento
          </Button>
        ) : null}
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
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Horas</th>
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

                return (
                  <tr key={item.id}>
                    <td className="px-4 py-3 text-sm">{item.data_lancamento ? new Date(item.data_lancamento).toLocaleDateString('pt-BR') : '-'}</td>
                    <td className="px-4 py-3 text-sm">
                      <p className="font-medium">{item.contrato_numero || '-'} - {item.contrato_nome}</p>
                      <p className="text-muted-foreground">{item.caso_numero || '-'} - {item.caso_nome}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{item.descricao || '-'}</p>
                    </td>
                    <td className="px-4 py-3 text-sm">{item.horas}</td>
                    <td className="px-4 py-3 text-sm">
                      <Badge className={statusClassName}>{item.status}</Badge>
                    </td>
                    <td className="px-4 py-3 text-sm">{item.created_by_nome || '-'}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {canWrite && item.status === 'em_lancamento' ? (
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
              <Label>Contrato</Label>
              <CommandSelect
                value={form.contrato_id}
                onValueChange={(value) => setForm((prev) => ({ ...prev, contrato_id: value, caso_id: '' }))}
                options={contratoOptions}
                placeholder="Selecione o contrato"
                searchPlaceholder="Buscar contrato..."
                emptyText="Nenhum contrato"
              />
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label>Caso</Label>
              <CommandSelect
                value={form.caso_id}
                onValueChange={(value) => setForm((prev) => ({ ...prev, caso_id: value }))}
                options={formCasoOptions}
                placeholder="Selecione o caso"
                searchPlaceholder="Buscar caso..."
                emptyText="Nenhum caso para o contrato"
                disabled={!form.contrato_id}
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
              <Label>Horas</Label>
              <Input
                type="number"
                step="0.25"
                min="0"
                value={form.horas}
                onChange={(event) => setForm((prev) => ({ ...prev, horas: event.target.value }))}
                placeholder="Ex: 1.5"
              />
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
