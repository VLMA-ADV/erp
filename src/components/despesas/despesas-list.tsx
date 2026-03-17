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

type DespesaStatus = 'em_lancamento' | 'revisao' | 'aprovado' | 'cancelado'

interface DespesaItem {
  id: string
  contrato_id: string
  contrato_numero: number | null
  contrato_nome: string
  caso_id: string
  caso_numero: number | null
  caso_nome: string
  cliente_id: string
  cliente_nome: string
  data_lancamento: string
  categoria: string
  descricao: string
  status: DespesaStatus
  arquivo_nome: string
  mime_type: string | null
  tamanho_bytes: number | null
  created_by_nome: string | null
  created_at: string
  updated_at: string
}

interface ContratoItem {
  id: string
  numero?: number
  cliente_id?: string
  cliente_nome?: string
  nome_contrato: string
  status?: string
  casos?: Array<{ id: string; numero?: number; nome: string; status?: string }>
}

interface FormState {
  id?: string
  cliente_id: string
  contrato_id: string
  caso_id: string
  data_lancamento: string
  categoria: string
  descricao: string
  arquivo: File | null
  arquivo_nome: string
}

const emptyForm: FormState = {
  cliente_id: '',
  contrato_id: '',
  caso_id: '',
  data_lancamento: '',
  categoria: '',
  descricao: '',
  arquivo: null,
  arquivo_nome: '',
}

function formatDate(value: string) {
  if (!value) return '-'
  const [year, month, day] = value.split('-')
  if (!year || !month || !day) return value
  return `${day}/${month}/${year}`
}

function formatStatus(status: DespesaStatus) {
  if (status === 'em_lancamento') return 'Em lançamento'
  if (status === 'revisao') return 'Revisão'
  if (status === 'aprovado') return 'Aprovado'
  if (status === 'cancelado') return 'Cancelado'
  return status
}

function statusClassName(status: DespesaStatus) {
  if (status === 'aprovado') return 'border-green-200 bg-green-50 text-green-700'
  if (status === 'revisao') return 'border-blue-200 bg-blue-50 text-blue-700'
  if (status === 'cancelado') return 'border-red-200 bg-red-50 text-red-700'
  return 'border-amber-200 bg-amber-50 text-amber-700'
}

const CATEGORIA_OPTIONS = [
  { value: 'custas', label: 'Custas' },
  { value: 'cartorio', label: 'Cartório' },
  { value: 'deslocamento', label: 'Deslocamento' },
  { value: 'hospedagem', label: 'Hospedagem' },
  { value: 'alimentacao', label: 'Alimentação' },
  { value: 'outros', label: 'Outros' },
]

export default function DespesasList() {
  const { hasPermission } = usePermissionsContext()
  const { success, error: toastError } = useToast()

  const canRead = hasPermission('operations.despesas.read') || hasPermission('operations.despesas.*') || hasPermission('operations.*')
  const canWrite = hasPermission('operations.despesas.write') || hasPermission('operations.despesas.*') || hasPermission('operations.*')

  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [items, setItems] = useState<DespesaItem[]>([])
  const [contratos, setContratos] = useState<ContratoItem[]>([])

  const [filterClienteId, setFilterClienteId] = useState('')
  const [filterCasoId, setFilterCasoId] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterCategoria, setFilterCategoria] = useState('')
  const [filterDataInicio, setFilterDataInicio] = useState('')
  const [filterDataFim, setFilterDataFim] = useState('')

  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState<FormState>(emptyForm)

  const getSession = async () => {
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    return session
  }

  const clienteOptions = useMemo(() => {
    const unique = new Map<string, string>()
    for (const contrato of contratos) {
      if (!contrato.cliente_id) continue
      if (!unique.has(contrato.cliente_id)) unique.set(contrato.cliente_id, contrato.cliente_nome || 'Cliente sem nome')
    }
    return Array.from(unique.entries()).map(([value, label]) => ({ value, label }))
  }, [contratos])

  const casesByCliente = useMemo(() => {
    if (!form.cliente_id) return [] as Array<{ id: string; nome: string; numero?: number; contrato_id: string; contrato_nome: string; contrato_numero?: number }>
    return contratos
      .filter((contrato) => contrato.cliente_id === form.cliente_id)
      .flatMap((contrato) =>
        (contrato.casos || []).map((caso) => ({
          ...caso,
          contrato_id: contrato.id,
          contrato_nome: contrato.nome_contrato,
          contrato_numero: contrato.numero,
        })),
      )
  }, [contratos, form.cliente_id])

  const formCasoOptions = useMemo(
    () =>
      casesByCliente.map((caso) => ({
        value: caso.id,
        label: `${caso.numero || '-'} - ${caso.nome} (${caso.contrato_numero || '-'} - ${caso.contrato_nome})`,
      })),
    [casesByCliente],
  )

  const filterCaseOptions = useMemo(() => {
    if (!filterClienteId) {
      return contratos.flatMap((contrato) =>
        (contrato.casos || []).map((caso) => ({
          value: caso.id,
          label: `${caso.numero || '-'} - ${caso.nome} (${contrato.numero || '-'} - ${contrato.nome_contrato})`,
        })),
      )
    }
    return contratos
      .filter((contrato) => contrato.cliente_id === filterClienteId)
      .flatMap((contrato) =>
        (contrato.casos || []).map((caso) => ({
          value: caso.id,
          label: `${caso.numero || '-'} - ${caso.nome} (${contrato.numero || '-'} - ${contrato.nome_contrato})`,
        })),
      )
  }, [contratos, filterClienteId])

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (filterClienteId && item.cliente_id !== filterClienteId) return false
      return true
    })
  }, [items, filterClienteId])

  const fetchContratos = async () => {
    const session = await getSession()
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
    if (!response.ok || !Array.isArray(payload.data)) return
    const contratosAtivos = (payload.data as ContratoItem[])
      .filter((item) => item.status === 'ativo')
      .map((item) => ({
        ...item,
        casos: (item.casos || []).filter((caso) => (caso.status || 'ativo') === 'ativo'),
      }))
      .filter((item) => (item.casos || []).length > 0)
    setContratos(contratosAtivos)
  }

  const fetchDespesas = async () => {
    try {
      setLoading(true)
      setError(null)
      const session = await getSession()
      if (!session) return

      const params = new URLSearchParams()
      if (filterCasoId) params.set('caso_id', filterCasoId)
      if (filterStatus) params.set('status', filterStatus)
      if (filterCategoria.trim()) params.set('categoria', filterCategoria.trim())
      if (filterDataInicio) params.set('data_inicio', filterDataInicio)
      if (filterDataFim) params.set('data_fim', filterDataFim)
      params.set('_ts', String(Date.now()))

      const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-despesas?${params.toString()}`, {
        method: 'GET',
        cache: 'no-store',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
      })

      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(payload.error || 'Erro ao carregar despesas')
        return
      }

      setItems((payload.data || []) as DespesaItem[])
    } catch (err) {
      console.error(err)
      setError('Erro ao carregar despesas')
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
    void fetchDespesas()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canRead, filterCasoId, filterStatus, filterCategoria, filterDataInicio, filterDataFim])

  useEffect(() => {
    if (!form.cliente_id || !form.caso_id) return
    const selected = casesByCliente.find((entry) => entry.id === form.caso_id)
    if (!selected) {
      setForm((prev) => ({ ...prev, caso_id: '', contrato_id: '' }))
    }
  }, [casesByCliente, form.caso_id, form.cliente_id])

  useEffect(() => {
    if (!filterCasoId) return
    const available = filterCaseOptions.some((item) => item.value === filterCasoId)
    if (!available) setFilterCasoId('')
  }, [filterCaseOptions, filterCasoId])

  const openCreate = () => {
    setForm({
      ...emptyForm,
      data_lancamento: new Date().toISOString().slice(0, 10),
    })
    setDialogOpen(true)
  }

  const openEdit = (item: DespesaItem) => {
    setForm({
      id: item.id,
      cliente_id: item.cliente_id,
      contrato_id: item.contrato_id,
      caso_id: item.caso_id,
      data_lancamento: item.data_lancamento,
      categoria: item.categoria || '',
      descricao: item.descricao || '',
      arquivo: null,
      arquivo_nome: item.arquivo_nome || '',
    })
    setDialogOpen(true)
  }

  const toBase64 = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.readAsDataURL(file)
      reader.onload = () => {
        const result = String(reader.result || '')
        resolve(result.includes(',') ? result.split(',')[1] : result)
      }
      reader.onerror = reject
    })

  const saveDespesa = async () => {
    if (!form.cliente_id) {
      toastError('Cliente é obrigatório')
      return
    }
    if (!form.caso_id || !form.contrato_id) {
      toastError('Caso é obrigatório')
      return
    }
    if (!form.categoria.trim()) {
      toastError('Categoria é obrigatória')
      return
    }
    if (!form.id && !form.arquivo) {
      toastError('Arquivo é obrigatório')
      return
    }

    try {
      setSubmitting(true)
      const session = await getSession()
      if (!session) return

      const payload: Record<string, unknown> = {
        id: form.id,
        contrato_id: form.contrato_id,
        caso_id: form.caso_id,
        data_lancamento: form.data_lancamento || null,
        categoria: form.categoria.trim(),
        descricao: form.descricao.trim(),
      }

      if (form.arquivo) {
        payload.arquivo_nome = form.arquivo.name
        payload.mime_type = form.arquivo.type || null
        payload.tamanho_bytes = form.arquivo.size || null
        payload.arquivo_base64 = await toBase64(form.arquivo)
      }

      const endpoint = form.id ? 'update-despesa' : 'create-despesa'
      const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/${endpoint}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })

      const result = await response.json().catch(() => ({}))
      if (!response.ok) {
        toastError(result.error || 'Erro ao salvar despesa')
        return
      }

      success(form.id ? 'Despesa atualizada com sucesso' : 'Despesa criada com sucesso')
      setDialogOpen(false)
      setForm(emptyForm)
      await fetchDespesas()
    } catch (err) {
      console.error(err)
      toastError('Erro ao salvar despesa')
    } finally {
      setSubmitting(false)
    }
  }

  if (!canRead) {
    return (
      <Alert className="border-amber-200 bg-amber-50 text-amber-900">
        <AlertTitle>Acesso negado</AlertTitle>
        <AlertDescription>Você não tem permissão para visualizar despesas.</AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="space-y-4">
      {error ? (
        <Alert className="border-red-200 bg-red-50 text-red-800">
          <AlertTitle>Erro</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid grid-cols-1 gap-3 rounded-md border bg-muted/20 p-3 md:grid-cols-6">
        <div className="space-y-1">
          <Label>Cliente</Label>
          <CommandSelect
            value={filterClienteId}
            onValueChange={setFilterClienteId}
            options={clienteOptions}
            placeholder="Todos"
            searchPlaceholder="Buscar cliente..."
            emptyText="Nenhum cliente encontrado."
          />
        </div>
        <div className="space-y-1">
          <Label>Caso</Label>
          <CommandSelect
            value={filterCasoId}
            onValueChange={setFilterCasoId}
            options={filterCaseOptions}
            placeholder="Todos"
            searchPlaceholder="Buscar caso..."
            emptyText="Nenhum caso encontrado."
          />
        </div>
        <div className="space-y-1">
          <Label>Status</Label>
          <CommandSelect
            value={filterStatus}
            onValueChange={setFilterStatus}
            options={[
              { value: '', label: 'Todos' },
              { value: 'em_lancamento', label: 'Em lançamento' },
              { value: 'revisao', label: 'Revisão' },
              { value: 'aprovado', label: 'Aprovado' },
              { value: 'cancelado', label: 'Cancelado' },
            ]}
            placeholder="Todos"
            searchPlaceholder="Buscar status..."
            emptyText="Nenhum status."
          />
        </div>
        <div className="space-y-1">
          <Label>Categoria</Label>
          <Input value={filterCategoria} onChange={(event) => setFilterCategoria(event.target.value)} placeholder="Ex: custas" />
        </div>
        <div className="space-y-1">
          <Label>Data início</Label>
          <DatePicker value={filterDataInicio} onChange={setFilterDataInicio} />
        </div>
        <div className="space-y-1">
          <Label>Data fim</Label>
          <DatePicker value={filterDataFim} onChange={setFilterDataFim} />
        </div>
      </div>

      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" onClick={() => void fetchDespesas()} disabled={loading}>
          Atualizar
        </Button>
        {canWrite ? (
          <Button onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" />
            Nova despesa
          </Button>
        ) : null}
      </div>

      <div className="overflow-hidden rounded-md border bg-white">
        <Table className="w-full min-w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Data</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Cliente</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Caso</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Categoria</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Descrição</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Arquivo</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Status</th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase text-gray-500">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-sm text-muted-foreground">
                  Carregando despesas...
                </td>
              </tr>
            ) : filteredItems.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-sm text-muted-foreground">
                  Nenhuma despesa encontrada.
                </td>
              </tr>
            ) : (
              filteredItems.map((item) => (
                <tr key={item.id}>
                  <td className="px-4 py-3 text-sm">{formatDate(item.data_lancamento)}</td>
                  <td className="px-4 py-3 text-sm">{item.cliente_nome || '-'}</td>
                  <td className="px-4 py-3 text-sm">
                    {item.caso_numero ? `${item.caso_numero} - ` : ''}
                    {item.caso_nome || '-'}
                    <div className="text-xs text-muted-foreground">
                      Contrato {item.contrato_numero ? `${item.contrato_numero} - ` : ''}{item.contrato_nome || '-'}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm">{item.categoria || '-'}</td>
                  <td className="px-4 py-3 text-sm">
                    <p className="line-clamp-2">{item.descricao || '-'}</p>
                  </td>
                  <td className="px-4 py-3 text-sm">{item.arquivo_nome || '-'}</td>
                  <td className="px-4 py-3 text-sm">
                    <Badge className={statusClassName(item.status)}>{formatStatus(item.status)}</Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {canWrite ? (
                      <Button type="button" variant="ghost" size="sm" onClick={() => openEdit(item)}>
                        <Edit className="mr-1 h-4 w-4" />
                        Editar
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">-</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </Table>
      </div>

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open)
          if (!open) setForm(emptyForm)
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{form.id ? 'Editar despesa' : 'Nova despesa'}</DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="space-y-1 md:col-span-2">
              <Label>Cliente</Label>
              <CommandSelect
                value={form.cliente_id}
                onValueChange={(value) => setForm((prev) => ({ ...prev, cliente_id: value, caso_id: '', contrato_id: '' }))}
                options={clienteOptions}
                placeholder="Selecione o cliente"
                searchPlaceholder="Buscar cliente..."
                emptyText="Nenhum cliente encontrado."
                disabled={submitting}
              />
            </div>

            <div className="space-y-1 md:col-span-2">
              <Label>Caso</Label>
              <CommandSelect
                value={form.caso_id}
                onValueChange={(value) => {
                  const selectedCase = casesByCliente.find((entry) => entry.id === value)
                  setForm((prev) => ({
                    ...prev,
                    caso_id: value,
                    contrato_id: selectedCase?.contrato_id || '',
                  }))
                }}
                options={formCasoOptions}
                placeholder="Selecione o caso"
                searchPlaceholder="Buscar caso..."
                emptyText="Nenhum caso encontrado."
                disabled={!form.cliente_id || submitting}
              />
            </div>

            <div className="space-y-1">
              <Label>Categoria</Label>
              <CommandSelect
                value={form.categoria}
                onValueChange={(value) => setForm((prev) => ({ ...prev, categoria: value }))}
                options={CATEGORIA_OPTIONS}
                placeholder="Selecione a categoria"
                searchPlaceholder="Buscar categoria..."
                emptyText="Nenhuma categoria encontrada."
                disabled={submitting}
              />
            </div>

            <div className="space-y-1">
              <Label>Data</Label>
              <DatePicker
                value={form.data_lancamento}
                onChange={(value) => setForm((prev) => ({ ...prev, data_lancamento: value }))}
              />
            </div>

            <div className="space-y-1 md:col-span-2">
              <Label>Descrição</Label>
              <Textarea
                value={form.descricao}
                onChange={(event) => setForm((prev) => ({ ...prev, descricao: event.target.value }))}
                rows={4}
                placeholder="Descreva a despesa"
                disabled={submitting}
              />
            </div>

            <div className="space-y-1 md:col-span-2">
              <Label>Arquivo</Label>
              <Input
                type="file"
                onChange={(event) => {
                  const file = event.target.files?.[0] || null
                  setForm((prev) => ({
                    ...prev,
                    arquivo: file,
                    arquivo_nome: file?.name || prev.arquivo_nome,
                  }))
                }}
                disabled={submitting}
              />
              {form.arquivo_nome ? (
                <p className="text-xs text-muted-foreground">Arquivo atual: {form.arquivo_nome}</p>
              ) : null}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={submitting}>
              Cancelar
            </Button>
            <Button onClick={() => void saveDespesa()} disabled={submitting}>
              {submitting ? 'Salvando...' : form.id ? 'Atualizar despesa' : 'Criar despesa'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
