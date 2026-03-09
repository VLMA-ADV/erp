'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { FilePlus2, Paperclip } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { usePermissionsContext } from '@/lib/contexts/permissions-context'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CommandSelect } from '@/components/ui/command-select'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table } from '@/components/ui/table'
import { useToast } from '@/components/ui/toast'

interface SolicitacaoAnexo {
  id: string
  nome: string
  arquivo_nome: string
  mime_type: string | null
  tamanho_bytes: number | null
  created_at: string
}

interface SolicitacaoContrato {
  id: string
  descricao: string
  nome?: string | null
  status: 'aberta' | 'concluida' | 'cancelada'
  cliente_id: string | null
  cliente_nome: string | null
  contrato_id: string | null
  contrato_numero: number | null
  contrato_nome: string | null
  solicitante_user_id: string
  solicitante_nome: string | null
  concluida_em: string | null
  created_at: string
  anexos: SolicitacaoAnexo[]
}

interface ClienteOption {
  id: string
  nome: string
}

interface PendingAnexo {
  nome: string
  file: File
}

async function fileToBase64(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })

  const parts = dataUrl.split(',')
  return parts[1] || ''
}

function formatDate(value?: string | null) {
  if (!value) return '-'
  const dt = new Date(value)
  if (Number.isNaN(dt.getTime())) return '-'
  return dt.toLocaleDateString('pt-BR')
}

function formatBytes(value?: number | null) {
  if (!value || value <= 0) return '-'
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

export default function SolicitacoesContratoList() {
  const { hasPermission } = usePermissionsContext()
  const { success, error: toastError } = useToast()

  const canRead =
    hasPermission('contracts.solicitacoes.read') || hasPermission('contracts.solicitacoes.*') || hasPermission('contracts.*')
  const canWrite =
    hasPermission('contracts.solicitacoes.write') || hasPermission('contracts.solicitacoes.*') || hasPermission('contracts.*')
  const canManage =
    hasPermission('contracts.solicitacoes.manage') || hasPermission('contracts.solicitacoes.*') || hasPermission('contracts.*')

  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [items, setItems] = useState<SolicitacaoContrato[]>([])
  const [search, setSearch] = useState('')

  const [createOpen, setCreateOpen] = useState(false)
  const [nomeSolicitacao, setNomeSolicitacao] = useState('')
  const [pendingAnexos, setPendingAnexos] = useState<PendingAnexo[]>([])
  const [openingAnexoId, setOpeningAnexoId] = useState<string | null>(null)

  const [clientes, setClientes] = useState<ClienteOption[]>([])
  const [selectedClienteId, setSelectedClienteId] = useState('')

  const clientesOptions = useMemo(
    () =>
      clientes.map((c) => ({
        value: c.id,
        label: c.nome,
      })),
    [clientes],
  )

  const filteredItems = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return items

    return items.filter((item) => {
      const contratoLabel = `${item.contrato_numero || ''} ${item.contrato_nome || ''}`.toLowerCase()
      const nome = (item.nome || '').toLowerCase()
      return (
        item.descricao.toLowerCase().includes(term) ||
        nome.includes(term) ||
        (item.cliente_nome || '').toLowerCase().includes(term) ||
        (item.solicitante_nome || '').toLowerCase().includes(term) ||
        contratoLabel.includes(term)
      )
    })
  }, [items, search])

  const getSession = async () => {
    const supabase = createClient()
    const {
      data: { session },
    } = await supabase.auth.getSession()
    return session
  }

  const fetchClientes = async () => {
    const session = await getSession()
    if (!session) return

    const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-clientes?_ts=${Date.now()}`, {
      method: 'GET',
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
    })

    const payload = await response.json()
    if (!response.ok) return
    setClientes((payload.data || []) as ClienteOption[])
  }

  const fetchItems = async () => {
    try {
      setLoading(true)
      setError(null)
      const session = await getSession()
      if (!session) return

      const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-solicitacoes-contrato`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
      })

      const payload = await response.json()
      if (!response.ok) {
        setError(payload.error || 'Erro ao carregar solicitações')
        return
      }

      setItems((payload.data || []) as SolicitacaoContrato[])
    } catch (err) {
      console.error(err)
      setError('Erro ao carregar solicitações')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!canRead) return
    void fetchItems()
    void fetchClientes()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canRead])

  const onAddFiles = (files: FileList | null) => {
    if (!files) return
    const file = files[0]
    if (!file) return
    setPendingAnexos([{ nome: 'Proposta', file }])
  }

  const createSolicitacao = async () => {
    if (!nomeSolicitacao.trim()) {
      toastError('Nome é obrigatório')
      return
    }

    if (pendingAnexos.length === 0) {
      toastError('Anexo de proposta é obrigatório')
      return
    }

    if (!selectedClienteId) {
      toastError('Cliente é obrigatório')
      return
    }

    try {
      setSubmitting(true)
      const session = await getSession()
      if (!session) return

      const anexosPayload = await Promise.all(
        pendingAnexos.map(async (item) => ({
          nome: 'Proposta',
          arquivo_nome: item.file.name,
          mime_type: item.file.type || 'application/octet-stream',
          tamanho_bytes: item.file.size,
          arquivo_base64: await fileToBase64(item.file),
        })),
      )

      const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/create-solicitacao-contrato`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          nome: nomeSolicitacao.trim(),
          descricao: nomeSolicitacao.trim(),
          cliente_id: selectedClienteId,
          anexos: anexosPayload,
        }),
      })

      const payload = await response.json()
      if (!response.ok) {
        toastError(payload.error || 'Erro ao criar solicitação')
        return
      }

      success('Solicitação criada com sucesso')
      setCreateOpen(false)
      setNomeSolicitacao('')
      setSelectedClienteId('')
      setPendingAnexos([])
      await fetchItems()
    } catch (err) {
      console.error(err)
      toastError('Erro ao criar solicitação')
    } finally {
      setSubmitting(false)
    }
  }

  const openSolicitacaoAnexo = async (anexoId: string) => {
    try {
      setOpeningAnexoId(anexoId)
      const session = await getSession()
      if (!session) return

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-anexo?tipo=solicitacao&id=${anexoId}`,
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
        toastError(payload.error || 'Erro ao abrir anexo')
        return
      }

      const item = payload.data || {}
      const mimeType = item.mime_type || 'application/octet-stream'
      const byteString = atob(item.arquivo_base64 || '')
      const bytes = new Uint8Array(byteString.length)
      for (let i = 0; i < byteString.length; i += 1) bytes[i] = byteString.charCodeAt(i)
      const blob = new Blob([bytes], { type: mimeType })
      const url = URL.createObjectURL(blob)
      window.open(url, '_blank')
      setTimeout(() => URL.revokeObjectURL(url), 10000)
    } catch (err) {
      console.error(err)
      toastError('Erro ao abrir anexo')
    } finally {
      setOpeningAnexoId(null)
    }
  }

  if (!canRead) {
    return (
      <Alert className="border-red-200 bg-red-50 text-red-700">
        <AlertTitle>Atenção</AlertTitle>
        <AlertDescription>Você não tem permissão para visualizar solicitações de contrato.</AlertDescription>
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

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Input
          className="max-w-md"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Buscar por descrição, solicitante ou contrato..."
        />

        {canWrite ? (
          <Button
            onClick={() => {
              setNomeSolicitacao('')
              setSelectedClienteId('')
              setPendingAnexos([])
              setCreateOpen(true)
            }}
          >
            <FilePlus2 className="mr-2 h-4 w-4" />
            Nova solicitação
          </Button>
        ) : null}
      </div>

      <div className="overflow-x-auto rounded-md border">
        <Table className="w-full min-w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Descrição</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Cliente</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Solicitante</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Status</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Contrato</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Anexos</th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase text-gray-500">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {loading ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-muted-foreground">
                  Carregando solicitações...
                </td>
              </tr>
            ) : filteredItems.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-muted-foreground">
                  Nenhuma solicitação encontrada.
                </td>
              </tr>
            ) : (
              filteredItems.map((item) => {
                const statusClassName =
                  item.status === 'concluida'
                    ? 'border-green-200 bg-green-100 text-green-700'
                    : item.status === 'cancelada'
                      ? 'border-red-200 bg-red-100 text-red-700'
                      : 'border-yellow-200 bg-yellow-100 text-yellow-700'

                return (
                  <tr key={item.id}>
                    <td className="px-4 py-3 align-top text-sm">
                      <p className="font-medium text-gray-900">{item.nome || item.descricao}</p>
                      <p className="mt-1 text-xs text-muted-foreground">Criada em {formatDate(item.created_at)}</p>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">{item.cliente_nome || '-'}</td>
                    <td className="px-4 py-3 text-sm text-gray-700">{item.solicitante_nome || '-'}</td>
                    <td className="px-4 py-3">
                      <Badge className={statusClassName}>{item.status}</Badge>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">
                      {item.contrato_id ? `${item.contrato_numero || '-'} - ${item.contrato_nome || '-'}` : '-'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">
                      {item.anexos?.length ? (
                        <div className="space-y-1">
                          {item.anexos.map((anexo) => (
                            <button
                              key={anexo.id}
                              type="button"
                              className="w-full rounded border p-2 text-left transition hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-60"
                              onClick={() => void openSolicitacaoAnexo(anexo.id)}
                              disabled={openingAnexoId === anexo.id}
                              title="Clique para visualizar o anexo"
                            >
                              <p className="font-medium">{anexo.nome}</p>
                              <p className="text-xs text-muted-foreground">
                                {anexo.arquivo_nome} · {formatBytes(anexo.tamanho_bytes)}
                                {openingAnexoId === anexo.id ? ' · Abrindo...' : ''}
                              </p>
                            </button>
                          ))}
                        </div>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        {item.status === 'concluida' && item.contrato_id ? (
                          <Link
                            href={`/contratos?search=${encodeURIComponent(
                              item.contrato_nome || String(item.contrato_numero || ''),
                            )}`}
                          >
                            <Button size="sm" variant="outline">Ir para contrato</Button>
                          </Link>
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

      <Dialog open={createOpen} onOpenChange={(open) => !submitting && setCreateOpen(open)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Nova solicitação de abertura de contrato</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Cliente</Label>
              <CommandSelect
                value={selectedClienteId}
                onValueChange={setSelectedClienteId}
                options={clientesOptions}
                placeholder="Selecione o cliente"
                searchPlaceholder="Buscar cliente..."
                emptyText="Nenhum cliente encontrado"
              />
            </div>

            <div className="space-y-2">
              <Label>Nome</Label>
              <Input
                value={nomeSolicitacao}
                onChange={(event) => setNomeSolicitacao(event.target.value)}
                placeholder="Nome da solicitação/contrato"
              />
            </div>

            <div className="space-y-2">
              <Label>Proposta</Label>
              <Input type="file" onChange={(event) => onAddFiles(event.target.files)} />
              {pendingAnexos.length ? (
                <div className="space-y-2 rounded-md border p-3">
                  {pendingAnexos.map((item, idx) => (
                    <div key={`${item.file.name}_${idx}`} className="flex items-center justify-between gap-2 text-sm">
                      <div className="flex items-center gap-2">
                        <Paperclip className="h-4 w-4 text-muted-foreground" />
                        <span>Proposta</span>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setPendingAnexos((prev) => prev.filter((_, i) => i !== idx))}
                      >
                        Remover
                      </Button>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={submitting}>
              Cancelar
            </Button>
            <Button onClick={createSolicitacao} disabled={submitting}>
              {submitting ? 'Salvando...' : 'Criar solicitação'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
