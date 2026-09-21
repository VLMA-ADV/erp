'use client'

import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import {
  STATUS_KIT_INFO,
  STATUS_KIT_ORDEM,
  formatMoney,
  type ComposicaoPayload,
  type StatusKit,
} from './types'

// Esteira do kit: Pendente → NF emitida → Enviado → Recebido. Cada card mostra
// quantos kits e quanto dinheiro estão naquele degrau; clicar filtra por ele
// (clicar de novo limpa). Filipe pediu "gráficos/resumo enviado → faturado →
// recebido" — quatro cards em linha dizem o mesmo sem esconder o número.
export default function ResumoStatus({
  resumo,
  ativo,
  onSelecionar,
}: {
  resumo: ComposicaoPayload['resumo'] | null
  ativo: StatusKit | null
  onSelecionar: (status: StatusKit | null) => void
}) {
  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-stretch">
      <div className="grid flex-1 grid-cols-2 gap-2 md:grid-cols-4">
        {STATUS_KIT_ORDEM.map((status, i) => {
          const info = STATUS_KIT_INFO[status]
          const dados = resumo?.por_status?.[status]
          const selecionado = ativo === status
          return (
            <button
              key={status}
              type="button"
              onClick={() => onSelecionar(selecionado ? null : status)}
              aria-pressed={selecionado}
              className={cn(
                'relative rounded-lg border p-3 text-left transition-colors',
                selecionado ? info.cardAtivo : info.card,
              )}
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wide">{info.label}</span>
                {i < STATUS_KIT_ORDEM.length - 1 ? (
                  <ChevronRight className="hidden h-3.5 w-3.5 opacity-40 md:block" />
                ) : null}
              </div>
              <p className="mt-1 text-2xl font-semibold font-tabular text-ink">{dados?.kits ?? 0}</p>
              <p className="text-xs text-ink-mute">
                {dados?.kits === 1 ? 'kit' : 'kits'} · <span className="font-tabular">{formatMoney(dados?.valor)}</span>
              </p>
            </button>
          )
        })}
      </div>
      <div className="flex min-w-[200px] flex-col justify-center rounded-lg border bg-muted/30 px-4 py-3">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-mute">Total geral</span>
        <p className="mt-1 text-2xl font-semibold font-tabular text-ink">{formatMoney(resumo?.valor_total)}</p>
        <p className="text-xs text-ink-mute">{resumo?.kits ?? 0} {resumo?.kits === 1 ? 'kit' : 'kits'} no filtro atual</p>
      </div>
    </div>
  )
}
