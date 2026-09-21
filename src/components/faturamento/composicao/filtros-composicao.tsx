'use client'

import { Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'
import { formatContratoDisplay } from '@/lib/utils/contrato-display'
import {
  FILTROS_VAZIOS,
  STATUS_KIT_INFO,
  STATUS_KIT_ORDEM,
  labelCompetencia,
  labelRegra,
  type ComposicaoPayload,
  type FiltrosComposicao,
  type StatusKit,
} from './types'

// Barra de filtros (Filipe, 21/09): competência, cliente, contrato, caso,
// regra de cobrança e status do kit. As opções vêm da RPC SEM filtro (para o
// select não esvaziar quando o filtro não casa com nada) e só contrato/caso
// são estreitados aqui pelo que está acima na hierarquia. A busca por texto é
// só de tela — não vai ao banco.
export default function FiltrosComposicao({
  opcoes,
  filtros,
  busca,
  onChange,
  onBusca,
}: {
  opcoes: ComposicaoPayload['opcoes'] | null
  filtros: FiltrosComposicao
  busca: string
  onChange: (next: FiltrosComposicao) => void
  onBusca: (texto: string) => void
}) {
  const contratos = (opcoes?.contratos ?? []).filter((c) => !filtros.clienteId || c.cliente_id === filtros.clienteId)
  const casos = (opcoes?.casos ?? []).filter((c) => {
    if (filtros.contratoId) return c.contrato_id === filtros.contratoId
    if (filtros.clienteId) return contratos.some((ct) => ct.id === c.contrato_id)
    return true
  })
  const temFiltro = Object.values(filtros).some(Boolean) || busca.trim() !== ''

  const set = (patch: Partial<FiltrosComposicao>) => onChange({ ...filtros, ...patch })

  return (
    <div className="rounded-lg border bg-white p-3">
      <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-7">
        <label className="space-y-1">
          <span className="text-[11px] font-medium uppercase tracking-wide text-ink-mute">Competência</span>
          <NativeSelect
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
          <span className="text-[11px] font-medium uppercase tracking-wide text-ink-mute">Cliente</span>
          <NativeSelect
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
          <span className="text-[11px] font-medium uppercase tracking-wide text-ink-mute">Contrato</span>
          <NativeSelect
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
          <span className="text-[11px] font-medium uppercase tracking-wide text-ink-mute">Caso</span>
          <NativeSelect
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
          <span className="text-[11px] font-medium uppercase tracking-wide text-ink-mute">Regra de cobrança</span>
          <NativeSelect
            value={filtros.regra ?? ''}
            onChange={(e) => set({ regra: e.target.value || null })}
          >
            <option value="">Todas</option>
            {(opcoes?.regras ?? []).map((r) => (
              <option key={r} value={r}>{labelRegra(r)}</option>
            ))}
          </NativeSelect>
        </label>

        <label className="space-y-1">
          <span className="text-[11px] font-medium uppercase tracking-wide text-ink-mute">Status do kit</span>
          <NativeSelect
            value={filtros.statusKit ?? ''}
            onChange={(e) => set({ statusKit: (e.target.value || null) as StatusKit | null })}
          >
            <option value="">Todos</option>
            {STATUS_KIT_ORDEM.map((s) => (
              <option key={s} value={s}>{STATUS_KIT_INFO[s].label}</option>
            ))}
          </NativeSelect>
        </label>

        <label className="space-y-1">
          <span className="text-[11px] font-medium uppercase tracking-wide text-ink-mute">Buscar</span>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-mute" />
            <Input
              value={busca}
              onChange={(e) => onBusca(e.target.value)}
              placeholder="Cliente ou caso"
              className="pl-8"
            />
          </div>
        </label>
      </div>

      {temFiltro ? (
        <div className="mt-2 flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onChange(FILTROS_VAZIOS)
              onBusca('')
            }}
          >
            <X className="mr-1.5 h-3.5 w-3.5" />
            Limpar filtros
          </Button>
        </div>
      ) : null}
    </div>
  )
}
