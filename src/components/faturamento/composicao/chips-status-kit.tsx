'use client'

import { Search, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils/cn'
import { STATUS_KIT_INFO, STATUS_KIT_ORDEM, type StatusKit } from './types'

// Chips da esteira do kit (Pendente → NF emitida → Enviado → Finalizado →
// Recebido) e a busca por texto na mesma linha. O chip é o antigo select
// "Status do kit": continua reconsultando a RPC com p_status_kit. A busca é
// só de tela. "Selecionar todos" (Filipe 24/09, item 6.1) marca os kits
// VISÍVEIS — respeita filtros e busca — que podem ser devolvidos/finalizados.
export interface SelecaoEmMassa {
  /** Kits visíveis que podem ser selecionados (pode_excluir). */
  selecionaveis: number
  selecionados: number
  onToggleTodos: (marcar: boolean) => void
}

export default function ChipsStatusKit({
  ativo,
  onSelecionar,
  busca,
  onBusca,
  selecao,
}: {
  ativo: StatusKit | null
  onSelecionar: (status: StatusKit | null) => void
  busca: string
  onBusca: (texto: string) => void
  selecao?: SelecaoEmMassa
}) {
  const chips: Array<{ valor: StatusKit | null; label: string; ativoClass: string }> = [
    { valor: null, label: 'Todos', ativoClass: 'border-ink bg-ink text-white' },
    ...STATUS_KIT_ORDEM.map((s) => ({ valor: s, label: STATUS_KIT_INFO[s].label, ativoClass: STATUS_KIT_INFO[s].cardAtivo })),
  ]
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Status do kit">
        {chips.map((chip) => {
          const selecionado = ativo === chip.valor
          return (
            <button
              key={chip.label}
              type="button"
              aria-pressed={selecionado}
              onClick={() => onSelecionar(chip.valor)}
              className={cn(
                'rounded-pill border px-3 py-1 text-xs font-medium transition-colors',
                selecionado ? chip.ativoClass : 'border-hairline bg-white text-ink-secondary hover:bg-canvas-soft hover:text-ink',
              )}
            >
              {chip.label}
            </button>
          )
        })}
      </div>
      <div className="flex items-center gap-3">
        {selecao ? (
          <label
            className={cn(
              'flex shrink-0 cursor-pointer items-center gap-2 text-xs text-ink-secondary',
              selecao.selecionaveis === 0 && 'cursor-not-allowed opacity-50',
            )}
            title={selecao.selecionaveis === 0 ? 'Nenhum kit selecionável nesta lista' : 'Marca todos os kits visíveis'}
          >
            <input
              type="checkbox"
              className="h-4 w-4 accent-primary"
              disabled={selecao.selecionaveis === 0}
              checked={selecao.selecionaveis > 0 && selecao.selecionados >= selecao.selecionaveis}
              ref={(el) => {
                if (el) el.indeterminate = selecao.selecionados > 0 && selecao.selecionados < selecao.selecionaveis
              }}
              onChange={(e) => selecao.onToggleTodos(e.target.checked)}
              aria-label="Selecionar todos os kits visíveis"
            />
            Selecionar todos
            {selecao.selecionados > 0 ? <span className="font-tabular text-ink-mute">({selecao.selecionados})</span> : null}
          </label>
        ) : null}
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-mute" />
          <Input
            value={busca}
            onChange={(e) => onBusca(e.target.value)}
            placeholder="Buscar cliente ou caso"
            aria-label="Buscar cliente ou caso"
            className="h-9 pl-8 pr-8"
          />
          {busca ? (
            <button
              type="button"
              onClick={() => onBusca('')}
              aria-label="Limpar busca"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-ink-mute hover:bg-canvas-soft hover:text-ink"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
