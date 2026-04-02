'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { FilePlus2, Paperclip } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { usePermissionsContext } from '@/lib/contexts/permissions-context'
import { maskCNPJ, onlyDigits } from '@/lib/utils/masks'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CommandSelect } from '@/components/ui/command-select'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
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

interface AreaOption {
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
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { hasPermission } = usePermissionsContext()
  const { success, error: toastError } = useToast()

  const canRead =
    hasPermission('contracts.solicitacoes.read')
  const canWrite =
    hasPermission('contracts.solicitacoes.write')

  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [items, setItems] = useState<SolicitacaoContrato[]>([])
  const [search, setSearch] = useState('')

  const [createOpen, setCreateOpen] = useState(false)
  const [nomeSolicitacao, setNomeSolicitacao] = useState('')
  const [descricaoSolicitacao, setDescricaoSolicitacao] = useState('')
  const [nomeClienteNovo, setNomeClienteNovo] = useState('')
  const [cnpjClienteNovo, setCnpjClienteNovo] = useState('')
  const [centroCustoId, setCentroCustoId] = useState('')
  const [pendingAnexos, setPendingAnexos] = useState<PendingAnexo[]>([])
  const [openingAnexoId, setOpeningAnexoId] = useState<string | null>(null)
  const [creatingCliente, setCreatingCliente] = useState(false)
  const [crmCardIdPrefill, setCrmCardIdPrefill] = useState('')
  const [lastCrmPrefillToken, setLastCrmPrefillToken] = useState('')

  const [clientes, setClientes] = useState<ClienteOption[]>([])
  const [areas, setAreas] = useState<AreaOption[]>([])
  const [selectedClienteId, setSelectedClienteId] = useState('')

  const clientesOptions = useMemo(
    () =>
      clientes.map((c) => ({
        value: c.id,
        label: c.nome,
      })),
    [clientes],
  )

  const areasOptions = useMemo(
    () =>
      areas.map((area) => ({
        value: area.id,
        label: area.nome,
      })),
    [areas],
  )

  const hasSelectedCliente = selectedClienteId.trim().length > 0
  const hasNomeClienteNovo = nomeClienteNovo.trim().length > 0

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

  const getFunctionsHeaders = (accessToken: string) => {
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    return {
      Authorization: `Bearer ${accessToken}`,
      ...(anonKey ? { apikey: anonKey } : {}),
      'Content-Type': 'application/json',
    }
  }

  const fetchClientes = async () => {
    const session = await getSession()
    if (!session) return

    const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-clientes?_ts=${Date.now()}`, {
      method: 'GET',
      cache: 'no-store',
      headers: {
        ...getFunctionsHeaders(session.access_token),
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
          ...getFunctionsHeaders(session.access_token),
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

  const fetchAreas = async () => {
    const session = await getSession()
    if (!session) return

    const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-areas?_ts=${Date.now()}`, {
      method: 'GET',
      cache: 'no-store',
      headers: {
        ...getFunctionsHeaders(session.access_token),
      },
    })

    const payload = await response.json().catch(() => ({}))
    if (!response.ok) return

    const nextAreas = (payload.data || [])
      .filter((item: any) => item?.id && item?.nome)
      .map((item: any) => ({ id: item.id as string, nome: item.nome as string }))

    setAreas(nextAreas)
  }

  useEffect(() => {
    if (!canRead) return
    void fetchItems()
    void fetchClientes()
    void fetchAreas()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canRead])

  useEffect(() => {
    if (!canWrite) return
    if (searchParams.get('from_crm') !== '1') return

    const token = [
      searchParams.get('crm_card_id') || '',
      searchParams.get('cliente_id') || '',
      searchParams.get('nome') || '',
      searchParams.get('descricao') || '',
      searchParams.get('nome_cliente_novo') || '',
      searchParams.get('cnpj_cliente_novo') || '',
      searchParams.get('centro_custo_id') || '',
    ].join('|')

    if (!token || token === lastCrmPrefillToken) return

    setNomeSolicitacao(searchParams.get('nome') || '')
    setDescricaoSolicitacao(searchParams.get('descricao') || '')
    setSelectedClienteId(searchParams.get('cliente_id') || '')
    setNomeClienteNovo(searchParams.get('nome_cliente_novo') || '')
    setCnpjClienteNovo(maskCNPJ(searchParams.get('cnpj_cliente_novo') || ''))
    setCentroCustoId(searchParams.get('centro_custo_id') || '')
    setPendingAnexos([])
    setCrmCardIdPrefill(searchParams.get('crm_card_id') || '')
    setCreateOpen(true)
    setLastCrmPrefillToken(token)

    router.replace(pathname, { scroll: false })
  }, [canWrite, lastCrmPrefillToken, pathname, router, searchParams])

  const resetCreateForm = () => {
    setNomeSolicitacao('')
    setDescricaoSolicitacao('')
    setSelectedClienteId('')
    setNomeClienteNovo('')
    setCnpjClienteNovo('')
    setCentroCustoId('')
    setPendingAnexos([])
    setCrmCardIdPrefill('')
  }

  const onAddFiles = (files: FileList | null) => {
    if (!files) return
    const file = files[0]
    if (!file) return
    setPendingAnexos([{ nome: 'Proposta', file }])
  }

  const createClienteOnDemand = async (nomeCliente: string) => {
    const nome = nomeCliente.trim()
    if (!nome) return

    try {
      setCreatingCliente(true)
      const session = await getSession()
      if (!session) return

      const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/create-cliente`, {
        method: 'POST',
        headers: {
          ...getFunctionsHeaders(session.access_token),
        },
        body: JSON.stringify({
          nome,
          cliente_estrangeiro: true,
          tipo: 'pessoa_juridica',
        }),
      })

      const payload = await response.json()
      if (!response.ok) {
        toastError(payload.error || 'Erro ao criar cliente')
        return
      }

      const clienteId = payload?.data?.cliente?.id as string | undefined
      if (!clienteId) {
        toastError('Cliente criado, mas não foi possível selecionar automaticamente')
        await fetchClientes()
        return
      }

      await fetchClientes()
      setSelectedClienteId(clienteId)
      success('Cliente criado e selecionado')
    } catch (err) {
      console.error(err)
      toastError('Erro ao criar cliente')
    } finally {
      setCreatingCliente(false)
    }
  }

  const createSolicitacao = async () => {
    if (!nomeSolicitacao.trim()) {
      toastError('Nome é obrigatório')
      return
    }

    if (!descricaoSolicitacao.trim()) {
      toastError('Descrição é obrigatória')
      return
    }

    try {
      setSubmitting(true)
      const session = await getSession()
      if (!session) {
        toastError('Sessão expirada. Faça login novamente.')
        return
      }

      const anexosPayload =
        pendingAnexos.length === 0
          ? []
          : await Promise.all(
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
          ...getFunctionsHeaders(session.access_token),
        },
        body: JSON.stringify({
          nome: nomeSolicitacao.trim(),
          descricao: descricaoSolicitacao.trim(),
          cliente_id: selectedClienteId || null,
          nome_cliente_novo: nomeClienteNovo.trim() || null,
          cnpj_cliente_novo: onlyDigits(cnpjClienteNovo) || null,
          centro_custo_id: centroCustoId || null,
          anexos: anexosPayload.length ? anexosPayload : undefined,
        }),
      })

      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        const errMsg =
          typeof payload?.error === 'string' && payload.error.trim().length > 0
            ? payload.error
            : `Erro ao criar solicitação (HTTP ${response.status})`
        const details =
          typeof payload?.details === 'string' && payload.details.trim().length > 0 ? ` — ${payload.details}` : ''
        toastError(`${errMsg}${details}`)
        return
      }

      const solicitacaoId = typeof payload?.data?.id === 'string' ? (payload.data.id as string) : ''

      if (crmCardIdPrefill && solicitacaoId) {
        try {
          await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/update-crm-pipeline-card`, {
            method: 'POST',
            headers: {
              ...getFunctionsHeaders(session.access_token),
            },
            body: JSON.stringify({
              id: crmCardIdPrefill,
              converted_solicitacao_id: solicitacaoId,
            }),
          })
        } catch (crmError) {
          console.warn('Não foi possível vincular a solicitação ao card do CRM:', crmError)
        }
      }

      success('Solicitação criada com sucesso')
      setCreateOpen(false)
      resetCreateForm()
      await fetchItems()
    } catch (err) {
      console.error(err)
      toastError(err instanceof Error ? `Erro ao criar solicitação — ${err.message}` : 'Erro ao criar solicitação')
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
            ...getFunctionsHeaders(session.access_token),
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
              resetCreateForm()
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
                      {item.descricao && item.descricao !== item.nome ? (
                        <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{item.descricao}</p>
                      ) : null}
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
                            href={`/contratos?contrato_id=${encodeURIComponent(item.contrato_id)}&search=${encodeURIComponent(
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
                onCreateOption={(value) => void createClienteOnDemand(value)}
                createOptionLabel={creatingCliente ? 'Cadastrando' : 'Cadastrar cliente'}
                disabled={creatingCliente || hasNomeClienteNovo}
              />
            </div>

            <div className="space-y-2">
              <Label>Nome do cliente novo</Label>
              <Input
                value={nomeClienteNovo}
                onChange={(event) => setNomeClienteNovo(event.target.value)}
                placeholder="Preencha apenas se o cliente ainda não existir"
                disabled={hasSelectedCliente}
              />
            </div>

            <div className="space-y-2">
              <Label>CNPJ do cliente novo</Label>
              <Input
                value={cnpjClienteNovo}
                onChange={(event) => setCnpjClienteNovo(maskCNPJ(event.target.value))}
                placeholder="00.000.000/0000-00"
                disabled={hasSelectedCliente}
              />
            </div>

            <div className="space-y-2">
              <Label>Nome do contrato</Label>
              <Input
                value={nomeSolicitacao}
                onChange={(event) => setNomeSolicitacao(event.target.value)}
                placeholder="Nome da solicitação/contrato"
              />
            </div>

            <div className="space-y-2">
              <Label>Descrição</Label>
              <Textarea
                value={descricaoSolicitacao}
                onChange={(event) => setDescricaoSolicitacao(event.target.value)}
                placeholder="Descreva a solicitação para o financeiro concluir o cadastro"
                rows={4}
              />
            </div>

            <div className="space-y-2">
              <Label>Centro de custo</Label>
              <CommandSelect
                value={centroCustoId}
                onValueChange={setCentroCustoId}
                options={areasOptions}
                placeholder="Selecione o centro de custo"
                searchPlaceholder="Buscar centro de custo..."
                emptyText="Nenhum centro de custo encontrado"
                disabled={submitting}
              />
            </div>

            <div className="space-y-2">
              <Label>Anexo de proposta</Label>
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
            <Button type="button" variant="outline" onClick={() => setCreateOpen(false)} disabled={submitting}>
              Cancelar
            </Button>
            <Button type="button" onClick={() => void createSolicitacao()} disabled={submitting}>
              {submitting ? 'Salvando...' : 'Criar solicitação'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
