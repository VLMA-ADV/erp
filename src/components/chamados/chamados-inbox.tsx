'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { ArrowUpRight, Loader2, Plus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  QK_CHAMADOS,
  STATUS_ABERTOS,
  classesStatus,
  listarChamados,
  rotuloModulo,
  rotuloStatus,
  solicitanteDiferente,
  type ChamadoResumoItem,
} from '@/lib/chamados/api'
import AvatarAutor from './avatar-autor'
import ChamadoDetalhe from './chamado-detalhe'
import NovoChamadoDialog from './novo-chamado-dialog'

const LIMITE_INBOX = 30

function dataRelativa(value: string) {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return formatDistanceToNow(d, { addSuffix: true, locale: ptBR })
}

/**
 * Aba "Chamados" da caixa de entrada flutuante (decisão 2.6c). Lista compacta:
 * não lidos primeiro, depois os abertos, depois o resto — quem abre o painel
 * quer ver o que mudou, não o histórico. "Ver todos" leva para /chamados.
 */
export default function ChamadosInbox({ onFechar }: { onFechar?: () => void } = {}) {
  const [novoAberto, setNovoAberto] = useState(false)
  const [detalheId, setDetalheId] = useState<string | null>(null)

  const { data, isLoading, isError, error } = useQuery({
    queryKey: [QK_CHAMADOS, 'inbox'],
    queryFn: () => listarChamados({ limit: LIMITE_INBOX }),
    staleTime: 60_000,
  })

  const itens = useMemo(() => {
    const lista = data?.itens ?? []
    const peso = (item: ChamadoResumoItem) =>
      (item.nao_lido ? 0 : 2) + (STATUS_ABERTOS.includes(item.status) ? 0 : 1)
    return [...lista].sort((a, b) => peso(a) - peso(b))
  }, [data])

  const naoLidos = itens.filter((i) => i.nao_lido).length

  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-xs text-ink-mute">
          {isLoading
            ? 'Carregando...'
            : naoLidos === 0
              ? 'Nada novo por aqui.'
              : naoLidos === 1
                ? '1 chamado com novidade'
                : `${naoLidos} chamados com novidade`}
        </p>
        <div className="flex items-center gap-2">
          <Link
            href="/chamados"
            onClick={onFechar}
            className="inline-flex items-center gap-1 text-xs font-medium text-ink-secondary hover:text-ink"
          >
            Ver todos
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
          <Button size="sm" onClick={() => setNovoAberto(true)}>
            <Plus className="mr-1 h-4 w-4" />
            Novo chamado
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 rounded-lg border bg-white p-4 text-sm text-ink-mute">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando chamados...
        </div>
      ) : isError ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error instanceof Error ? error.message : 'Não foi possível carregar os chamados'}
        </div>
      ) : itens.length === 0 ? (
        <div className="rounded-lg border bg-white p-4 text-sm text-ink-mute">
          Nenhum chamado ainda. Encontrou um erro ou tem uma sugestão? Abra um chamado.
        </div>
      ) : (
        <div className="space-y-2" data-testid="chamados-inbox-lista">
          {itens.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setDetalheId(item.id)}
              className={`flex w-full items-start gap-2.5 rounded-xl border bg-white p-3 text-left shadow-sm transition hover:border-sky-200 ${
                item.nao_lido ? 'border-l-4 border-l-[#E8871E]' : ''
              }`}
            >
              <AvatarAutor nome={item.autor?.nome} foto={item.autor?.foto_url} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className={`truncate text-sm text-ink ${item.nao_lido ? 'font-semibold' : 'font-medium'}`}>
                    <span className="mr-1 text-xs text-ink-mute">#{item.numero}</span>
                    {item.titulo}
                  </span>
                  <span className="shrink-0 text-xs text-ink-mute">{dataRelativa(item.updated_at || item.created_at)}</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <Badge className={classesStatus(item.status)}>{rotuloStatus(item.status)}</Badge>
                  <Badge>{rotuloModulo(item.modulo)}</Badge>
                  {item.urgencia === 'urgente' ? (
                    <Badge className="border-red-200 bg-red-50 text-red-700">Urgente</Badge>
                  ) : null}
                  <span className="text-xs text-ink-mute">
                    {solicitanteDiferente(item.autor, item.solicitante)
                      ? `aberto por ${item.autor?.nome ?? 'autor desconhecido'} · solicitante ${item.solicitante?.nome}`
                      : item.autor?.nome ?? 'Autor desconhecido'}
                  </span>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      <NovoChamadoDialog open={novoAberto} onOpenChange={setNovoAberto} onCriado={(c) => setDetalheId(c.id)} />
      <ChamadoDetalhe chamadoId={detalheId} onClose={() => setDetalheId(null)} />
    </>
  )
}
