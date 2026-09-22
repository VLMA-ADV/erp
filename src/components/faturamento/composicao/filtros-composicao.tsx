'use client'

import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { NativeSelect } from '@/components/ui/native-select'
import { formatContratoDisplay } from '@/lib/utils/contrato-display'
import {
  labelCompetencia,
  labelRegra,
  type ComposicaoPayload,
  type FiltrosComposicao,
} from './types'

// Barra de filtros (Filipe, 21/09): competência, cliente, contrato, caso e
// regra de cobrança, numa linha só em telas largas. As opções vêm da RPC SEM
// filtro (para o select não esvaziar quando o filtro não casa com nada) e só
// contrato/caso são estreitados aqui pelo que está acima na hierarquia. O
// status do kit virou chip (ChipsStatusKit) e a busca foi junto com ele.
export default function FiltrosComposicao({
  opcoes,
  filtros,
  onChange,
  onLimpar,
  temBusca,
  extra,
}: {
  opcoes: ComposicaoPayload['opcoes'] | null
  filtros: FiltrosComposicao
  onChange: (next: FiltrosComposicao) => void
  /** Zera filtros E busca — quem orquestra sabe onde a busca mora. */
  onLimpar: () => void
  temBusca: boolean
  /** Botões à direita da barra (ex.: Atualizar). */
  extra?: React.ReactNode
}) {
  const contratos = (opcoes?.contratos ?? []).filter((c) => !filtros.clienteId || c.cliente_id === filtros.clienteId)
  const casos = (opcoes?.casos ?? []).filter((c) => {
    if (filtros.contratoId) return c.contrato_id === filtros.contratoId
    if (filtros.clienteId) return contratos.some((ct) => ct.id === c.contrato_id)
    return true
  })
  const temFiltro = Object.values(filtros).some(Boolean) || temBusca

  const set = (patch: Partial<FiltrosComposicao>) => onChange({ ...filtros, ...patch })
  const selectClass = 'h-9 text-xs'
  const labelClass = 'text-[11px] font-medium uppercase tracking-wide text-ink-mute'

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-hairline bg-white p-3 xl:flex-row xl:items-end">
      <div className="grid flex-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <label className="space-y-1">
          <span className={labelClass}>Competência</span>
          <NativeSelect
            className={selectClass}
            value={filtros.competencia ?? ''}
            onChange={(e) => set({ competencia: e.target.value || null })}
          >
            <option value="">Todas</option>
            {(opcoes?.competencias ?? []).map((c) => (
              <option key={c} value={c}>{labelCompetencia(c)}</option>
            ))}
          </NativeSelect>
        </label>

        <label className="space-y-1">
          <span className={labelClass}>Cliente</span>
          <NativeSelect
            className={selectClass}
            value={filtros.clienteId ?? ''}
            // Trocar o cliente invalida contrato e caso escolhidos abaixo dele.
            onChange={(e) => set({ clienteId: e.target.value || null, contratoId: null, casoId: null })}
          >
            <option value="">Todos</option>
            {(opcoes?.clientes ?? []).map((c) => (
              <option key={c.id} value={c.id}>{c.nome}</option>
            ))}
          </NativeSelect>
        </label>

        <label className="space-y-1">
          <span className={labelClass}>Contrato</span>
          <NativeSelect
            className={selectClass}
            value={filtros.contratoId ?? ''}
            onChange={(e) => set({ contratoId: e.target.value || null, casoId: null })}
          >
            <option value="">Todos</option>
            {contratos.map((c) => (
              <option key={c.id} value={c.id}>{formatContratoDisplay(c.numero, c.nome).full}</option>
            ))}
          </NativeSelect>
        </label>

        <label className="space-y-1">
          <span className={labelClass}>Caso</span>
          <NativeSelect
            className={selectClass}
            value={filtros.casoId ?? ''}
            onChange={(e) => set({ casoId: e.target.value || null })}
          >
            <option value="">Todos</option>
            {casos.map((c) => (
              <option key={c.id} value={c.id}>{c.numero ? `#${c.numero} · ` : ''}{c.nome}</option>
            ))}
          </NativeSelect>
        </label>

        <label className="space-y-1">
          <span className={labelClass}>Regra de cobrança</span>
          <NativeSelect
            className={selectClass}
            value={filtros.regra ?? ''}
            onChange={(e) => set({ regra: e.target.value || null })}
          >
            <option value="">Todas</option>
            {(opcoes?.regras ?? []).map((r) => (
              <option key={r} value={r}>{labelRegra(r)}</option>
            ))}
          </NativeSelect>
        </label>
      </div>

      <div className="flex shrink-0 items-center justify-end gap-2">
        {temFiltro ? (
          <Button variant="ghost" size="sm" className="h-9" onClick={onLimpar}>
            <X className="mr-1.5 h-3.5 w-3.5" />
            Limpar filtros
          </Button>
        ) : null}
        {extra}
      </div>
    </div>
  )
}
