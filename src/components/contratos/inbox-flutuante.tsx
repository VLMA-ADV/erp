'use client'

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Inbox, MessageSquare, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { usePermissionsContext } from '@/lib/contexts/permissions-context'
import { fetchWithRetry } from '@/lib/utils/fetch-with-retry'
import SolicitacoesInbox from './solicitacoes-inbox'
import MensagensInbox from './mensagens-inbox'

/**
 * Caixa de entrada como ícone, não como aba (pedido Filipe 07/08): ele quer ver
 * de longe que chegou coisa, sem precisar lembrar de abrir uma aba.
 *
 * Fica em Contratos — foi onde ele pediu, e é quem tem acesso a Contratos que
 * resolve solicitação. O contador é recarregado de tempos em tempos; realtime
 * ficaria mais elegante, mas custa mais e o ganho aqui é pequeno.
 */
const INTERVALO_ATUALIZACAO_MS = 60_000

async function contarPendentes({ signal }: { signal?: AbortSignal } = {}): Promise<number> {
  const supabase = createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return 0

  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const response = await fetchWithRetry(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-solicitacoes-contrato`,
    {
      method: 'GET',
      cache: 'no-store',
      signal,
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        ...(anonKey ? { apikey: anonKey } : {}),
        'Content-Type': 'application/json',
      },
    },
  )
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) return 0
  const lista = Array.isArray(payload.data) ? payload.data : []
  return lista.filter((item: { status?: string; lido_at?: string | null }) =>
    item?.status === 'aberta' && !item?.lido_at).length
}

type Aba = 'solicitacoes' | 'mensagens'

export default function InboxFlutuante() {
  const { hasPermission } = usePermissionsContext()
  const canRead = hasPermission('contracts.solicitacoes.read')
  const [aberto, setAberto] = useState(false)
  const [aba, setAba] = useState<Aba>('solicitacoes')

  const { data: pendentes = 0 } = useQuery({
    queryKey: ['inbox-pendentes'],
    queryFn: ({ signal }) => contarPendentes({ signal }),
    refetchInterval: INTERVALO_ATUALIZACAO_MS,
    enabled: canRead,
  })

  // Esc fecha o painel — é meia janela, não uma página.
  useEffect(() => {
    if (!aberto) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setAberto(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [aberto])

  if (!canRead) return null

  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-[#E8871E] text-white shadow-lg transition hover:bg-[#d1791b] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E8871E] focus-visible:ring-offset-2"
        aria-label={pendentes > 0 ? `Caixa de entrada, ${pendentes} pendente(s)` : 'Caixa de entrada'}
        title="Caixa de entrada"
      >
        <Inbox className="h-6 w-6" />
        {pendentes > 0 ? (
          <span className="absolute -right-1 -top-1 flex h-6 min-w-6 items-center justify-center rounded-full bg-red-600 px-1.5 text-xs font-semibold text-white ring-2 ring-white">
            {pendentes > 99 ? '99+' : pendentes}
          </span>
        ) : null}
      </button>

      {aberto ? (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/25"
            onClick={() => setAberto(false)}
            aria-hidden="true"
          />
          <aside
            className="fixed right-0 top-0 z-50 flex h-full w-full flex-col border-l border-hairline bg-white shadow-2xl sm:w-[38rem]"
            role="dialog"
            aria-label="Caixa de entrada"
          >
            <header className="flex items-center justify-between border-b border-hairline px-5 py-4">
              <h2 className="text-lg font-semibold text-ink">Caixa de entrada</h2>
              <button
                type="button"
                onClick={() => setAberto(false)}
                className="rounded-full p-1.5 text-ink-mute hover:bg-canvas-soft"
                aria-label="Fechar"
              >
                <X className="h-5 w-5" />
              </button>
            </header>

            <nav className="flex gap-1 border-b border-hairline px-5">
              <button
                type="button"
                onClick={() => setAba('solicitacoes')}
                className={`flex items-center gap-1.5 border-b-2 px-1 py-3 text-sm transition ${
                  aba === 'solicitacoes'
                    ? 'border-[#E8871E] font-semibold text-ink'
                    : 'border-transparent text-ink-mute hover:text-ink-secondary'
                }`}
              >
                Solicitações de contrato
                {pendentes > 0 ? (
                  <span className="rounded-full bg-[#FFF7ED] px-1.5 py-0.5 text-[11px] font-semibold text-[#B45309]">
                    {pendentes}
                  </span>
                ) : null}
              </button>
              <button
                type="button"
                onClick={() => setAba('mensagens')}
                className={`ml-4 flex items-center gap-1.5 border-b-2 px-1 py-3 text-sm transition ${
                  aba === 'mensagens'
                    ? 'border-[#E8871E] font-semibold text-ink'
                    : 'border-transparent text-ink-mute hover:text-ink-secondary'
                }`}
              >
                <MessageSquare className="h-4 w-4" />
                Mensagens
              </button>
            </nav>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {aba === 'solicitacoes' ? <SolicitacoesInbox /> : <MensagensInbox />}
            </div>
          </aside>
        </>
      ) : null}
    </>
  )
}
