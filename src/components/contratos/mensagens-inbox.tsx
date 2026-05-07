'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { Check, ChevronDown, ChevronRight, FilePlus2, MessageSquare } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tooltip } from '@/components/ui/tooltip'
import { useToast } from '@/components/ui/toast'
import { createClient } from '@/lib/supabase/client'
import { usePermissionsContext } from '@/lib/contexts/permissions-context'
import MensagemAvulsaFormFields, {
  type PendingMensagemAnexo,
} from '@/components/mensagens/mensagem-avulsa-form-fields'
import type { CommandSelectOption } from '@/components/ui/command-select'

interface MensagemAvulsaItem {
  id: string
  mensagem: string
  created_at: string
  cliente_id: string | null
  caso_id: string | null
  autor_id: string | null
  cliente_nome: string | null
  caso_nome: string | null
  autor_nome: string | null
  lido_at?: string | null
}

interface ClienteOption {
  id: string
  nome: string
}

interface CasoOption {
  id: string
  nome: string
  cliente_id: string | null
}

interface ContratoListItem {
  id: string
  cliente_id?: string | null
  casos?: { id: string; nome?: string | null }[]
}

const PREVIEW_LIMIT = 5

function formatRelativeDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'data indisponível'
  return formatDistanceToNow(date, { addSuffix: true, locale: ptBR })
}

function totalLabel(total: number) {
  if (total === 0) return 'Nenhuma mensagem'
  if (total === 1) return '1 mensagem'
  return `${total} mensagens`
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

async function fetchMensagensAvulsas(
  _opts: { signal?: AbortSignal } = {},
): Promise<MensagemAvulsaItem[]> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return []

  // F-fix: SELECT cross-schema (PR #89) batia em 42501 "permission denied for schema contracts".
  // RPC SECURITY DEFINER list_mensagens_avulsas_inbox faz JOIN cliente/caso/autor internamente.
  const { data, error } = await supabase.rpc('list_mensagens_avulsas_inbox', {
    p_user_id: user.id,
    p_limit: PREVIEW_LIMIT,
    p_only_unread: true,
  })

  if (error) {
    throw new Error(error.message || 'Erro ao carregar mensagens')
  }

  return (data ?? []) as MensagemAvulsaItem[]
}

export default function MensagensInbox() {
  const queryClient = useQueryClient()
  const { hasPermission } = usePermissionsContext()
  const { success, error: toastError } = useToast()
  const canRead = hasPermission('contracts.solicitacoes.read')
  const canWrite = hasPermission('contracts.solicitacoes.write')
  const canCreateCliente = hasPermission('crm.clientes.write')

  const [open, setOpen] = useState(false)
  const [markingId, setMarkingId] = useState<string | null>(null)

  const [createOpen, setCreateOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [creatingCliente, setCreatingCliente] = useState(false)
  const [mensagem, setMensagem] = useState('')
  const [selectedClienteId, setSelectedClienteId] = useState('')
  const [selectedCasoId, setSelectedCasoId] = useState('')
  const [pendingAnexos, setPendingAnexos] = useState<PendingMensagemAnexo[]>([])

  const [clientes, setClientes] = useState<ClienteOption[]>([])
  const [casos, setCasos] = useState<CasoOption[]>([])
  const [loadingCasos, setLoadingCasos] = useState(false)

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['mensagens-avulsas-inbox'],
    queryFn: ({ signal }) => fetchMensagensAvulsas({ signal }),
    staleTime: 60_000,
    enabled: canRead,
  })

  const mensagens = data ?? []
  const total = mensagens.length
  const isEmpty = !isLoading && total === 0
  const badgeLabel = isError ? 'Erro ao carregar' : isLoading ? 'Carregando...' : totalLabel(total)

  const clientesOptions = useMemo<CommandSelectOption[]>(
    () => clientes.map((c) => ({ value: c.id, label: c.nome })),
    [clientes],
  )

  const casosOptions = useMemo<CommandSelectOption[]>(
    () =>
      casos
        .filter((c) => !selectedClienteId || c.cliente_id === selectedClienteId)
        .map((c) => ({ value: c.id, label: c.nome })),
    [casos, selectedClienteId],
  )

  const getSession = async () => {
    const supabase = createClient()
    const {
      data: { session },
    } = await supabase.auth.getSession()
    return session
  }

  const headers = (accessToken: string) => {
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    return {
      Authorization: `Bearer ${accessToken}`,
      ...(anonKey ? { apikey: anonKey } : {}),
      'Content-Type': 'application/json',
    }
  }

  const fetchClientesAndCasos = async () => {
    setLoadingCasos(true)
    try {
      const session = await getSession()
      if (!session) return

      const [clientesRes, contratosRes] = await Promise.all([
        fetch(
          `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-clientes?_ts=${Date.now()}`,
          { method: 'GET', cache: 'no-store', headers: headers(session.access_token) },
        ),
        fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-contratos`, {
          method: 'GET',
          cache: 'no-store',
          headers: headers(session.access_token),
        }),
      ])

      const clientesPayload = await clientesRes.json().catch(() => ({}))
      const contratosPayload = await contratosRes.json().catch(() => ({}))

      if (clientesRes.ok) {
        setClientes((clientesPayload.data ?? []) as ClienteOption[])
      }

      if (contratosRes.ok) {
        const list = (contratosPayload.data ?? []) as ContratoListItem[]
        const flat: CasoOption[] = []
        for (const contrato of list) {
          const clienteId = contrato.cliente_id ?? null
          for (const caso of contrato.casos ?? []) {
            flat.push({
              id: caso.id,
              nome: caso.nome ?? 'Caso sem nome',
              cliente_id: clienteId,
            })
          }
        }
        setCasos(flat)
      }
    } finally {
      setLoadingCasos(false)
    }
  }

  useEffect(() => {
    if (!createOpen) return
    void fetchClientesAndCasos()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createOpen])

  // Cascata: ao trocar cliente, limpar caso selecionado
  useEffect(() => {
    setSelectedCasoId('')
  }, [selectedClienteId])

  const resetForm = () => {
    setMensagem('')
    setSelectedClienteId('')
    setSelectedCasoId('')
    setPendingAnexos([])
  }

  const onAddFiles = (files: FileList | null) => {
    if (!files?.length) return
    const next = Array.from(files).map((file) => ({ nome: file.name, file }))
    setPendingAnexos((prev) => [...prev, ...next])
  }

  const createClienteOnDemand = async (nomeCliente: string) => {
    const nome = nomeCliente.trim()
    if (!nome) return
    try {
      setCreatingCliente(true)
      const session = await getSession()
      if (!session) return

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/create-cliente`,
        {
          method: 'POST',
          headers: headers(session.access_token),
          body: JSON.stringify({
            nome,
            cliente_estrangeiro: true,
            tipo: 'pessoa_juridica',
          }),
        },
      )
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        toastError(payload.error || 'Erro ao criar cliente')
        return
      }
      const clienteId = payload?.data?.cliente?.id as string | undefined
      await fetchClientesAndCasos()
      if (clienteId) setSelectedClienteId(clienteId)
      success('Cliente criado e selecionado')
    } catch (err) {
      console.error(err)
      toastError('Erro ao criar cliente')
    } finally {
      setCreatingCliente(false)
    }
  }

  const handleMarkAsRead = async (mensagemId: string) => {
    try {
      setMarkingId(mensagemId)
      const supabase = createClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) return
      const { error: rpcError } = await supabase.rpc('mark_mensagem_as_read', {
        p_user_id: user.id,
        p_mensagem_id: mensagemId,
      })
      if (rpcError) {
        toastError(rpcError.message || 'Erro ao marcar como lida')
        return
      }
      await queryClient.invalidateQueries({ queryKey: ['mensagens-avulsas-inbox'] })
    } finally {
      setMarkingId(null)
    }
  }

  const submitMensagem = async () => {
    if (!mensagem.trim()) {
      toastError('Mensagem é obrigatória')
      return
    }
    if (!selectedClienteId && !selectedCasoId) {
      toastError('Selecione um cliente ou caso')
      return
    }

    try {
      setSubmitting(true)
      const supabase = createClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        toastError('Sessão expirada. Faça login novamente.')
        return
      }

      const anexosPayload =
        pendingAnexos.length === 0
          ? []
          : await Promise.all(
              pendingAnexos.map(async (item) => ({
                nome: item.nome.trim() || item.file.name,
                arquivo_nome: item.file.name,
                mime_type: item.file.type || 'application/octet-stream',
                tamanho_bytes: item.file.size,
                arquivo_base64: await fileToBase64(item.file),
              })),
            )

      // Plan C: RPC pública direta (criada na migration F).
      const { error: rpcError } = await supabase.rpc('create_mensagem_avulsa', {
        p_user_id: user.id,
        p_payload: {
          cliente_id: selectedClienteId || null,
          caso_id: selectedCasoId || null,
          mensagem: mensagem.trim(),
          anexos: anexosPayload.length ? anexosPayload : undefined,
        },
      })

      if (rpcError) {
        toastError(rpcError.message || 'Erro ao salvar mensagem')
        return
      }
      success('Mensagem registrada')
      setCreateOpen(false)
      resetForm()
      await queryClient.invalidateQueries({ queryKey: ['mensagens-avulsas-inbox'] })
    } catch (err) {
      console.error(err)
      toastError(err instanceof Error ? err.message : 'Erro ao salvar mensagem')
    } finally {
      setSubmitting(false)
    }
  }

  if (!canRead) return null

  return (
    <>
      <Collapsible
        open={open}
        onOpenChange={setOpen}
        className="overflow-hidden rounded-2xl border bg-white shadow-sm"
      >
        <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-900 text-white">
              <MessageSquare className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-900">Mensagens</p>
              <p className="mt-1 text-sm text-slate-500">
                Mensagens avulsas vinculadas a clientes e casos (sem solicitação de contrato).
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Badge
              className={
                isError
                  ? 'border-red-200 bg-red-50 text-red-700'
                  : total > 0
                    ? 'border-sky-200 bg-sky-50 text-sky-700'
                    : 'border-slate-200 bg-slate-50 text-slate-600'
              }
            >
              {badgeLabel}
            </Badge>
            {canWrite ? (
              <Button
                size="sm"
                onClick={() => {
                  resetForm()
                  setCreateOpen(true)
                }}
              >
                <FilePlus2 className="mr-1 h-4 w-4" />
                Nova mensagem
              </Button>
            ) : null}
            <CollapsibleTrigger asChild>
              <Button size="sm" variant="outline" disabled={(!isError && isEmpty) || isLoading}>
                {open ? <ChevronDown className="mr-1 h-4 w-4" /> : <ChevronRight className="mr-1 h-4 w-4" />}
                {open ? 'Ocultar' : 'Abrir'}
              </Button>
            </CollapsibleTrigger>
          </div>
        </div>

        <CollapsibleContent>
          <div className="border-t bg-slate-50/70 p-3">
            {isError ? (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {error instanceof Error ? error.message : 'Erro ao carregar mensagens'}
              </div>
            ) : mensagens.length === 0 ? (
              <div className="rounded-lg border bg-white p-4 text-sm text-slate-500">
                Nenhuma mensagem avulsa registrada.
              </div>
            ) : (
              <div className="space-y-2" data-testid="mensagens-inbox-lista">
                {mensagens.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-start gap-2 rounded-xl border bg-white p-3 shadow-sm transition hover:border-sky-200"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-sm font-semibold text-slate-900">
                          {item.autor_nome ?? 'Autor desconhecido'}
                        </span>
                        <span className="text-xs text-slate-400">•</span>
                        <span className="text-xs text-slate-500">{formatRelativeDate(item.created_at)}</span>
                      </div>
                      <p className="mt-1 text-xs font-medium uppercase tracking-wide text-slate-500">
                        {item.cliente_nome ?? 'Cliente —'}
                        {item.caso_nome ? ` · ${item.caso_nome}` : ''}
                      </p>
                      <p className="mt-2 line-clamp-2 text-sm text-slate-700">{item.mensagem}</p>
                    </div>
                    {canWrite ? (
                      <Tooltip content="Marcar como lida">
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 shrink-0"
                          disabled={markingId === item.id}
                          onClick={() => void handleMarkAsRead(item.id)}
                          aria-label="Marcar como lida"
                        >
                          <Check className="h-4 w-4 text-green-600" />
                        </Button>
                      </Tooltip>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>

      <Dialog
        open={createOpen}
        onOpenChange={(value) => {
          if (submitting) return
          setCreateOpen(value)
          if (!value) resetForm()
        }}
      >
        <DialogContent className="sm:max-w-2xl" data-testid="mensagem-avulsa-dialog">
          <DialogHeader>
            <DialogTitle>Nova mensagem</DialogTitle>
          </DialogHeader>

          <MensagemAvulsaFormFields
            casosOptions={casosOptions}
            clientesOptions={clientesOptions}
            creatingCliente={creatingCliente}
            disabled={submitting}
            loadingCasos={loadingCasos}
            mensagem={mensagem}
            onAddFiles={onAddFiles}
            onCreateCliente={canCreateCliente ? (value) => void createClienteOnDemand(value) : undefined}
            onMensagemChange={setMensagem}
            onRemovePendingAnexo={(index) =>
              setPendingAnexos((prev) => prev.filter((_, idx) => idx !== index))
            }
            onSelectedCasoIdChange={setSelectedCasoId}
            onSelectedClienteIdChange={setSelectedClienteId}
            pendingAnexos={pendingAnexos}
            selectedCasoId={selectedCasoId}
            selectedClienteId={selectedClienteId}
          />

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={submitting}
              onClick={() => setCreateOpen(false)}
            >
              Cancelar
            </Button>
            <Button type="button" onClick={() => void submitMensagem()} disabled={submitting}>
              {submitting ? 'Salvando...' : 'Registrar mensagem'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
