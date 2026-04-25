'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { ChevronDown, ChevronRight, ClipboardList, FileText } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { createClient } from '@/lib/supabase/client'
import { usePermissionsContext } from '@/lib/contexts/permissions-context'

interface SolicitacaoContratoItem {
  id: string
  descricao: string
  nome?: string | null
  status: 'aberta' | 'concluida' | 'cancelada'
  cliente_nome: string | null
  contrato_numero: number | null
  contrato_nome: string | null
  solicitante_nome: string | null
  created_at: string
}

const PREVIEW_LIMIT = 5

function formatRelativeDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'data indisponível'
  return formatDistanceToNow(date, { addSuffix: true, locale: ptBR })
}

function pendingLabel(total: number) {
  if (total === 0) return 'Nenhuma pendente'
  if (total === 1) return '1 pendente'
  return `${total} pendentes`
}

function clienteLabel(item: SolicitacaoContratoItem) {
  if (item.cliente_nome) return item.cliente_nome
  if (item.contrato_numero && item.contrato_nome) {
    return `${item.contrato_numero} - ${item.contrato_nome}`
  }
  return 'Cliente não informado'
}

async function fetchSolicitacoesAbertas(): Promise<SolicitacaoContratoItem[]> {
  const supabase = createClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session) return []

  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-solicitacoes-contrato`,
    {
      method: 'GET',
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        ...(anonKey ? { apikey: anonKey } : {}),
        'Content-Type': 'application/json',
      },
    },
  )

  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(typeof payload.error === 'string' ? payload.error : 'Erro ao carregar solicitações')
  }

  const list = Array.isArray(payload.data) ? (payload.data as SolicitacaoContratoItem[]) : []
  return list.filter((item) => item.status === 'aberta')
}

export default function SolicitacoesInbox() {
  const router = useRouter()
  const { hasPermission } = usePermissionsContext()
  const canRead = hasPermission('contracts.solicitacoes.read')
  const [open, setOpen] = useState(false)

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['solicitacoes-contrato-inbox'],
    queryFn: fetchSolicitacoesAbertas,
    staleTime: 60_000,
    enabled: canRead,
  })

  if (!canRead) return null

  const abertas = data ?? []
  const total = abertas.length
  const preview = abertas.slice(0, PREVIEW_LIMIT)
  const isEmpty = !isLoading && total === 0
  const badgeLabel = isError ? 'Erro ao carregar' : isLoading ? 'Carregando...' : pendingLabel(total)

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="overflow-hidden rounded-2xl border bg-white shadow-sm">
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-900 text-white">
            <ClipboardList className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-900">Solicitações de Contrato</p>
            <p className="mt-1 text-sm text-slate-500">
              Solicitações pendentes de abertura ou revisão de contrato.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Badge
            className={
              isError
                ? 'border-red-200 bg-red-50 text-red-700'
                : total > 0
                  ? 'border-amber-200 bg-amber-50 text-amber-700'
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
              {error instanceof Error ? error.message : 'Erro ao carregar solicitações'}
            </div>
          ) : preview.length === 0 ? (
            <div className="rounded-lg border bg-white p-4 text-sm text-slate-500">Nenhuma solicitação pendente</div>
          ) : (
            <div className="space-y-2">
              {preview.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="w-full rounded-xl border bg-white p-3 text-left shadow-sm transition hover:border-amber-200 hover:bg-amber-50/40"
                  onClick={() =>
                    router.push(`/solicitacoes-contrato?solicitacao_id=${encodeURIComponent(item.id)}`)
                  }
                >
                  <div className="flex gap-3">
                    <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
                      <FileText className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-sm font-semibold text-slate-900">
                          {item.nome || 'Solicitação sem título'}
                        </span>
                        <span className="text-xs text-slate-400">•</span>
                        <span className="text-xs text-slate-500">{formatRelativeDate(item.created_at)}</span>
                      </div>
                      <p className="mt-1 text-xs font-medium uppercase tracking-wide text-slate-500">
                        {clienteLabel(item)}
                        {item.solicitante_nome ? ` → ${item.solicitante_nome}` : ''}
                      </p>
                      <p className="mt-2 line-clamp-2 text-sm text-slate-700">{item.descricao}</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}

          <div className="mt-3 flex justify-end">
            <Button size="sm" variant="outline" onClick={() => router.push('/solicitacoes-contrato')}>
              Ver todas
            </Button>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
