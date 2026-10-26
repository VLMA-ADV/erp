'use client'

import { useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { ArrowUpRight, Loader2, Target } from 'lucide-react'
import Link from 'next/link'
import {
  QK_CAIXA_PDI,
  QK_CAIXA_PDI_PENDENTES,
  listarCaixaPdi,
  marcarCaixaPdiLida,
  type NotificacaoPdi,
} from '@/lib/pdi/api'

function dataRelativa(value: string) {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return formatDistanceToNow(d, { addSuffix: true, locale: ptBR })
}

/**
 * Aba "PDI" da caixa de entrada flutuante (26/10). Quando o colaborador envia a
 * autoavaliação de metas de um período, o aviso cai aqui para o coordenador da
 * área (área sem coordenador → sócios); quando o coordenador reabre, o aviso
 * vai para o colaborador; quando o colaborador retira o próprio envio ("Voltar
 * para edição"), quem recebeu o envio é avisado. Clicar marca como lido e abre
 * a tela certa.
 */
export default function PdiInbox({ onFechar }: { onFechar?: () => void } = {}) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { data = [], isLoading, isError, error } = useQuery({
    queryKey: [QK_CAIXA_PDI],
    queryFn: () => listarCaixaPdi(30),
    staleTime: 30_000,
  })

  const naoLidos = data.filter((n) => !n.lido_at).length

  const abrir = async (n: NotificacaoPdi) => {
    if (!n.lido_at) {
      await marcarCaixaPdiLida({ ids: [n.id] }).catch(() => null)
      void queryClient.invalidateQueries({ queryKey: [QK_CAIXA_PDI] })
      void queryClient.invalidateQueries({ queryKey: [QK_CAIXA_PDI_PENDENTES] })
    }
    onFechar?.()
    router.push(n.link)
  }

  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-xs text-ink-mute">
          {isLoading ? 'Carregando...' : naoLidos === 0 ? 'Nada novo por aqui.' : naoLidos === 1 ? '1 aviso novo do PDI' : `${naoLidos} avisos novos do PDI`}
        </p>
        <Link href="/avaliacoes-pdi" onClick={onFechar} className="inline-flex items-center gap-1 text-xs font-medium text-ink-secondary hover:text-ink">
          Avaliações PDI <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 rounded-lg border bg-white p-4 text-sm text-ink-mute">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando avisos...
        </div>
      ) : isError ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error instanceof Error ? error.message : 'Não foi possível carregar os avisos do PDI'}
        </div>
      ) : data.length === 0 ? (
        <div className="rounded-lg border bg-white p-4 text-sm text-ink-mute">
          Nenhum aviso do PDI. Quando alguém da sua área enviar a autoavaliação de metas, ela aparece aqui.
        </div>
      ) : (
        <div className="space-y-2" data-testid="pdi-inbox-lista">
          {data.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => void abrir(n)}
              className={`flex w-full items-start gap-2.5 rounded-xl border bg-white p-3 text-left shadow-sm transition hover:border-sky-200 ${!n.lido_at ? 'border-l-4 border-l-[#E8871E]' : ''}`}
            >
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-purple-soft text-brand-purple-fg">
                <Target className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <span className={`text-sm text-ink ${!n.lido_at ? 'font-semibold' : 'font-medium'}`}>{n.titulo}</span>
                  <span className="shrink-0 text-xs text-ink-mute">{dataRelativa(n.created_at)}</span>
                </div>
                <p className="mt-0.5 text-xs text-ink-mute">
                  {n.tipo === 'periodo_reaberto'
                    ? 'Abra o Meu PDI para editar e reenviar.'
                    : n.tipo === 'envio_retirado'
                      ? 'O colaborador voltou o período para edição — aguarde o novo envio.'
                      : 'Abra para continuar a avaliação (2ª etapa).'}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}
    </>
  )
}
