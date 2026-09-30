'use client'

import { competenciaAtual, mesPorExtenso } from '@/lib/faturamento/competencia'
import { formatMoney, type AbaCompetencia } from './types'

// Abas por mês (Filipe, 30/09): substituem o select "Competência" para ele
// dar baixa nos kits de setembro e acompanhar outubro sem trocar de filtro.
// Mesmo desenho da tablist "Mês de faturamento" da Revisão de fatura. Os
// números da aba (nº de kits e valor do mês) vêm de uma leitura SEM filtro
// da RPC — não mudam com cliente/contrato/caso/regra/status; só a lista muda.
export default function AbasCompetencia({
  abas,
  ativa,
  onEscolher,
}: {
  abas: AbaCompetencia[]
  ativa: string | null
  onEscolher: (competencia: string) => void
}) {
  const atual = competenciaAtual()
  return (
    <div className="flex flex-wrap items-end gap-1 border-b border-hairline" role="tablist" aria-label="Mês de faturamento">
      {abas.map((aba) => {
        const selecionada = aba.competencia === ativa
        return (
          <button
            key={aba.competencia}
            type="button"
            role="tab"
            aria-selected={selecionada}
            onClick={() => onEscolher(aba.competencia)}
            className={`-mb-px inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm transition-colors ${
              selecionada ? 'border-ink font-semibold text-ink' : 'border-transparent text-ink-mute hover:text-ink-secondary'
            }`}
          >
            <span>
              {mesPorExtenso(aba.competencia)}
              {aba.competencia === atual ? <span className="ml-1 text-[11px] font-normal text-ink-mute">· este mês</span> : null}
            </span>
            <span
              className={`rounded-full px-1.5 py-0.5 text-[11px] font-medium ${aba.kits > 0 ? 'bg-amber-100 text-amber-800' : 'bg-canvas-soft text-ink-mute'}`}
              title="Kits do mês"
            >
              {aba.kits}
            </span>
            {aba.kits > 0 ? (
              <span className="text-[11px] font-normal tabular-nums text-ink-mute" title="Valor total dos kits do mês">
                {formatMoney(aba.valor)}
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}
