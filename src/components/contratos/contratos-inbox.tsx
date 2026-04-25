'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { ChevronDown, ChevronRight, Inbox, MessageSquare } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { createClient } from '@/lib/supabase/client'
import { usePermissionsContext } from '@/lib/contexts/permissions-context'
import { fetchWithRetry } from '@/lib/utils/fetch-with-retry'

interface ContratosInboxMensagem {
  id: string
  solicitacao_id: string
  contrato_id: string | null
  contrato_codigo: string | null
  contrato_nome?: string | null
  solicitacao_nome?: string | null
  remetente_id: string
  remetente_nome: string
  mensagem_preview: string
  created_at: string
}

interface ContratosInboxResponse {
  mensagens: ContratosInboxMensagem[]
  total: number
}

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return 'U'
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join('')
}

function formatRelativeDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'data indisponível'
  return formatDistanceToNow(date, { addSuffix: true, locale: ptBR })
}

function messageCountLabel(total: number) {
  if (total === 0) return 'Nenhuma mensagem recente'
  if (total === 1) return '1 nova mensagem'
  return `${total} novas mensagens`
}

function contratoLabel(item: ContratosInboxMensagem) {
  if (item.contrato_codigo && item.contrato_nome) {
    return `${item.contrato_codigo} - ${item.contrato_nome}`
  }
  if (item.contrato_codigo) return `Contrato ${item.contrato_codigo}`
  if (item.contrato_nome) return item.contrato_nome
  return 'Sem contrato vinculado'
}

async function fetchContratosInbox({ signal }: { signal?: AbortSignal } = {}): Promise<ContratosInboxResponse> {
  const supabase = createClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session) return { mensagens: [], total: 0 }

  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const response = await fetchWithRetry(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/list-contratos-inbox-mensagens?limit=10`,
    {
      method: 'GET',
      signal,
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        ...(anonKey ? { apikey: anonKey } : {}),
        'Content-Type': 'application/json',
      },
    },
  )

  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(typeof payload.error === 'string' ? payload.error : 'Erro ao carregar mensagens recentes')
  }

  return {
    mensagens: Array.isArray(payload.mensagens) ? payload.mensagens : [],
    total: Number(payload.total || 0),
  }
}

export default function ContratosInbox() {
  const router = useRouter()
  const { hasPermission } = usePermissionsContext()
  const canRead = hasPermission('contracts.contratos.read')
  const [open, setOpen] = useState(false)

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['contratos-inbox-mensagens'],
    queryFn: ({ signal }) => fetchContratosInbox({ signal }),
    staleTime: 60_000,
    enabled: canRead,
  })

  if (!canRead) return null

  const total = data?.total ?? 0
  const mensagens = data?.mensagens ?? []
  const isEmpty = !isLoading && total === 0
  const badgeLabel = isError ? 'Erro ao carregar mensagens' : isLoading ? 'Carregando...' : messageCountLabel(total)

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="overflow-hidden rounded-2xl border bg-white shadow-sm">
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-900 text-white">
            <Inbox className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-900">Atualizações recentes de solicitações</p>
            <p className="mt-1 text-sm text-slate-500">
              Mensagens enviadas pelos usuários em solicitações vinculadas a contratos.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Badge
            className={
              isError
                ? 'border-red-200 bg-red-50 text-red-700'
                : total > 0
                  ? 'border-blue-200 bg-blue-50 text-blue-700'
                  : 'border-slate-200 bg-slate-50 text-slate-600'
            }
          >
            {badgeLabel}
          </Badge>
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
              {error instanceof Error ? error.message : 'Erro ao carregar mensagens recentes'}
            </div>
          ) : mensagens.length === 0 ? (
            <div className="rounded-lg border bg-white p-4 text-sm text-slate-500">Nenhuma mensagem recente</div>
          ) : (
            <div className="space-y-2">
              {mensagens.map((mensagem) => (
                <button
                  key={mensagem.id}
                  type="button"
                  className="w-full rounded-xl border bg-white p-3 text-left shadow-sm transition hover:border-blue-200 hover:bg-blue-50/40"
                  onClick={() =>
                    router.push(`/solicitacoes-contrato?solicitacao_id=${encodeURIComponent(mensagem.solicitacao_id)}`)
                  }
                >
                  <div className="flex gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-700">
                      {getInitials(mensagem.remetente_nome)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-sm font-semibold text-slate-900">{mensagem.remetente_nome}</span>
                        <span className="text-xs text-slate-400">•</span>
                        <span className="text-xs text-slate-500">{formatRelativeDate(mensagem.created_at)}</span>
                      </div>
                      <p className="mt-1 text-xs font-medium uppercase tracking-wide text-slate-500">
                        {contratoLabel(mensagem)}
                        {mensagem.solicitacao_nome ? ` → ${mensagem.solicitacao_nome}` : ''}
                      </p>
                      <p className="mt-2 line-clamp-2 text-sm text-slate-700">{mensagem.mensagem_preview}</p>
                    </div>
                    <MessageSquare className="mt-1 h-4 w-4 shrink-0 text-slate-300" />
                  </div>
                </button>
              ))}
            </div>
          )}

          <div className="mt-3 flex justify-end">
            <Button
              size="sm"
              variant="outline"
              onClick={() => router.push('/solicitacoes-contrato?sort=mensagens_recentes')}
            >
              Ver todas
            </Button>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
