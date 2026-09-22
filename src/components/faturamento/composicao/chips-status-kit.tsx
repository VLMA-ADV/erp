'use client'

import { Search, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils/cn'
import { STATUS_KIT_INFO, STATUS_KIT_ORDEM, type StatusKit } from './types'

// Chips da esteira do kit (Pendente → NF emitida → Enviado → Recebido) e a
// busca por texto na mesma linha. O chip é o antigo select "Status do kit":
// continua reconsultando a RPC com p_status_kit. A busca é só de tela.
export default function ChipsStatusKit({
  ativo,
  onSelecionar,
  busca,
  onBusca,
}: {
  ativo: StatusKit | null
  onSelecionar: (status: StatusKit | null) => void
  busca: string
  onBusca: (texto: string) => void
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
  )
}
