'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { AlertTriangle, Loader2, MessageSquare, Paperclip, Plus, RefreshCw, Search } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'
import {
  CATEGORIAS,
  MODULOS,
  QK_CHAMADOS,
  STATUS,
  classesStatus,
  listarChamados,
  rotuloCategoria,
  rotuloModulo,
  rotuloStatus,
  solicitanteDiferente,
  type ChamadoCategoria,
  type ChamadoModulo,
  type ChamadoResumoItem,
  type ChamadoStatus,
  type FiltrosChamados,
} from '@/lib/chamados/api'
import AvatarAutor from './avatar-autor'
import ChamadoDetalhe from './chamado-detalhe'
import NovoChamadoDialog from './novo-chamado-dialog'

function dataRelativa(value: string) {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return 'data indisponível'
  return formatDistanceToNow(d, { addSuffix: true, locale: ptBR })
}

function useDebounce<T>(valor: T, ms: number): T {
  const [debounced, setDebounced] = useState(valor)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(valor), ms)
    return () => clearTimeout(t)
  }, [valor, ms])
  return debounced
}

const CARDS_RESUMO: Array<{ status: ChamadoStatus; classes: string }> = [
  { status: 'recebido', classes: 'border-sky-200 bg-sky-50/60' },
  { status: 'em_analise', classes: 'border-amber-200 bg-amber-50/60' },
  { status: 'feito', classes: 'border-emerald-200 bg-emerald-50/60' },
  { status: 'nao_sera_feito', classes: 'border-hairline bg-canvas-soft' },
]

/**
 * Lista da Central de chamados (decisão 2.5c: todos veem a lista; só quem
 * responde muda status). Cards de resumo filtram por status ao clicar — o
 * Filipe quer bater o olho em "quantos estão parados em Recebido".
 */
export default function ChamadosList() {
  const [status, setStatus] = useState<ChamadoStatus | ''>('')
  const [categoria, setCategoria] = useState<ChamadoCategoria | ''>('')
  const [modulo, setModulo] = useState<ChamadoModulo | ''>('')
  const [somenteMeus, setSomenteMeus] = useState(false)
  const [busca, setBusca] = useState('')
  const buscaDebounced = useDebounce(busca.trim(), 350)

  const [novoAberto, setNovoAberto] = useState(false)
  const [detalheId, setDetalheId] = useState<string | null>(null)

  const filtros = useMemo<FiltrosChamados>(
    () => ({ status, categoria, modulo, somenteMeus, busca: buscaDebounced, limit: 200 }),
    [status, categoria, modulo, somenteMeus, buscaDebounced],
  )

  const { data, isLoading, isError, error, isFetching, refetch } = useQuery({
    queryKey: [QK_CHAMADOS, 'lista', filtros],
    queryFn: () => listarChamados(filtros),
    staleTime: 30_000,
  })

  const itens = data?.itens ?? []
  const resumo = data?.resumo
  const temFiltro = Boolean(status || categoria || modulo || somenteMeus || buscaDebounced)

  const limparFiltros = () => {
    setStatus('')
    setCategoria('')
    setModulo('')
    setSomenteMeus(false)
    setBusca('')
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="grid flex-1 grid-cols-2 gap-3 sm:grid-cols-4">
          {CARDS_RESUMO.map((card) => {
            const ativo = status === card.status
            const valor = resumo ? resumo[card.status] : null
            return (
              <button
                key={card.status}
                type="button"
                onClick={() => setStatus(ativo ? '' : card.status)}
                aria-pressed={ativo}
                className={`rounded-xl border p-3 text-left transition hover:shadow-sm ${card.classes} ${
                  ativo ? 'ring-2 ring-[#E8871E] ring-offset-1' : ''
                }`}
              >
                <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-mute">
                  {rotuloStatus(card.status)}
                </p>
                <p className="mt-1 text-2xl font-semibold text-ink">
                  {valor === null ? <span className="text-ink-mute">—</span> : valor}
                </p>
                {card.status === 'recebido' && resumo && resumo.urgentes_abertos > 0 ? (
                  <p className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-medium text-red-700">
                    <AlertTriangle className="h-3 w-3" />
                    {resumo.urgentes_abertos === 1
                      ? '1 urgente em aberto'
                      : `${resumo.urgentes_abertos} urgentes em aberto`}
                  </p>
                ) : null}
              </button>
            )
          })}
        </div>
        <Button onClick={() => setNovoAberto(true)} data-testid="chamados-novo">
          <Plus className="mr-1 h-4 w-4" />
          Novo chamado
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-hairline bg-white p-3">
        <div className="relative min-w-[14rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-mute" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por número, título ou descrição"
            className="pl-9"
            aria-label="Buscar chamados"
          />
        </div>
        <NativeSelect
          aria-label="Filtrar por status"
          className="h-10 w-auto"
          value={status}
          onChange={(e) => setStatus(e.target.value as ChamadoStatus | '')}
        >
          <option value="">Todos os status</option>
          {STATUS.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </NativeSelect>
        <NativeSelect
          aria-label="Filtrar por tipo"
          className="h-10 w-auto"
          value={categoria}
          onChange={(e) => setCategoria(e.target.value as ChamadoCategoria | '')}
        >
          <option value="">Todos os tipos</option>
          {CATEGORIAS.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </NativeSelect>
        <NativeSelect
          aria-label="Filtrar por módulo"
          className="h-10 w-auto"
          value={modulo}
          onChange={(e) => setModulo(e.target.value as ChamadoModulo | '')}
        >
          <option value="">Todos os módulos</option>
          {MODULOS.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </NativeSelect>
        <label className="inline-flex cursor-pointer items-center gap-2 px-1 text-sm text-ink">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-hairline"
            checked={somenteMeus}
            onChange={(e) => setSomenteMeus(e.target.checked)}
          />
          Só os meus
        </label>
        {temFiltro ? (
          <Button variant="ghost" size="sm" onClick={limparFiltros}>
            Limpar
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9"
          onClick={() => void refetch()}
          disabled={isFetching}
          aria-label="Atualizar lista"
          title="Atualizar"
        >
          <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 rounded-xl border border-hairline bg-white p-6 text-sm text-ink-mute">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando chamados...
        </div>
      ) : isError ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          {error instanceof Error ? error.message : 'Não foi possível carregar os chamados'}
          <Button variant="outline" size="sm" className="ml-3" onClick={() => void refetch()}>
            Tentar de novo
          </Button>
        </div>
      ) : itens.length === 0 ? (
        <div className="rounded-xl border border-dashed border-hairline bg-white p-8 text-center text-sm text-ink-mute">
          {temFiltro ? (
            <>
              Nenhum chamado com esses filtros.{' '}
              <button type="button" className="text-primary underline-offset-2 hover:underline" onClick={limparFiltros}>
                Limpar filtros
              </button>
            </>
          ) : (
            <>
              Nenhum chamado aberto ainda. Encontrou um erro ou tem uma sugestão para o ERP?{' '}
              <button type="button" className="text-primary underline-offset-2 hover:underline" onClick={() => setNovoAberto(true)}>
                Abra o primeiro chamado
              </button>
              .
            </>
          )}
        </div>
      ) : (
        <ul className="space-y-2" data-testid="chamados-lista">
          {itens.map((item) => (
            <li key={item.id}>
              <LinhaChamado item={item} onClick={() => setDetalheId(item.id)} />
            </li>
          ))}
        </ul>
      )}

      <NovoChamadoDialog
        open={novoAberto}
        onOpenChange={setNovoAberto}
        onCriado={(c) => setDetalheId(c.id)}
      />
      <ChamadoDetalhe chamadoId={detalheId} onClose={() => setDetalheId(null)} />
    </div>
  )
}

function LinhaChamado({ item, onClick }: { item: ChamadoResumoItem; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-start gap-3 rounded-xl border bg-white p-3 text-left shadow-sm transition hover:border-sky-200 ${
        item.nao_lido ? 'border-l-4 border-l-[#E8871E]' : 'border-hairline'
      }`}
      data-testid="chamado-linha"
    >
      <AvatarAutor nome={item.autor?.nome} foto={item.autor?.foto_url} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-xs font-semibold text-ink-mute">#{item.numero}</span>
          <span className={`truncate text-sm text-ink ${item.nao_lido ? 'font-semibold' : 'font-medium'}`}>
            {item.titulo}
          </span>
          {item.nao_lido ? (
            <span className="h-2 w-2 shrink-0 rounded-full bg-[#E8871E]" aria-label="Não lido" title="Novidade não lida" />
          ) : null}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <Badge className={classesStatus(item.status)}>{rotuloStatus(item.status)}</Badge>
          <Badge>{rotuloCategoria(item.categoria)}</Badge>
          <Badge>{rotuloModulo(item.modulo)}</Badge>
          {item.urgencia === 'urgente' ? (
            <Badge className="border-red-200 bg-red-50 text-red-700">Urgente</Badge>
          ) : null}
        </div>
        <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-ink-mute">
          {/* "aberto por X · solicitante Y" só quando são pessoas diferentes (Filipe 24/09). */}
          {solicitanteDiferente(item.autor, item.solicitante) ? (
            <span>
              aberto por {item.autor?.nome ?? 'autor desconhecido'} · solicitante{' '}
              <span className="font-medium text-ink-secondary">{item.solicitante?.nome}</span>
            </span>
          ) : (
            <span>{item.autor?.nome ?? 'Autor desconhecido'}</span>
          )}
          <span>{dataRelativa(item.updated_at || item.created_at)}</span>
          {item.responsavel?.nome ? <span>com {item.responsavel.nome}</span> : null}
          {item.total_mensagens > 0 ? (
            <span className="inline-flex items-center gap-1">
              <MessageSquare className="h-3 w-3" />
              {item.total_mensagens}
            </span>
          ) : null}
          {item.total_anexos > 0 ? (
            <span className="inline-flex items-center gap-1">
              <Paperclip className="h-3 w-3" />
              {item.total_anexos}
            </span>
          ) : null}
        </p>
      </div>
    </button>
  )
}
