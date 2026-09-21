'use client'

import { useMemo } from 'react'
import { cn } from '@/lib/utils/cn'
import {
  SITUACAO_INFO,
  formatMoney,
  progressoDoKit,
  somarProgresso,
  type ClienteKits,
  type ComposicaoPayload,
  type SituacaoKit,
} from './types'

// Linha de KPIs (mock do Filipe, 21/09): total a faturar, quantos kits
// estão completos / em andamento / não iniciados (contando documentos
// emitidos, ver progressoDoKit) e o progresso geral. Os três do meio filtram
// a lista na tela — clicar de novo limpa. Os números vêm dos clientes que a
// RPC devolveu para o filtro atual, sem a busca por texto nem o filtro de
// situação, para os cards não mudarem quando a pessoa clica num deles.
export default function ResumoStatus({
  resumo,
  clientes,
  ativo,
  onSelecionar,
}: {
  resumo: ComposicaoPayload['resumo'] | null
  clientes: ClienteKits[]
  ativo: SituacaoKit | null
  onSelecionar: (situacao: SituacaoKit | null) => void
}) {
  const dados = useMemo(() => {
    const kits = clientes.flatMap((c) => c.casos)
    const porSituacao: Record<SituacaoKit, { kits: number; valor: number }> = {
      completo: { kits: 0, valor: 0 },
      em_andamento: { kits: 0, valor: 0 },
      nao_iniciado: { kits: 0, valor: 0 },
    }
    for (const kit of kits) {
      const p = progressoDoKit(kit)
      porSituacao[p.situacao].kits += 1
      porSituacao[p.situacao].valor += Number(kit.valor_total || 0)
    }
    return { porSituacao, geral: somarProgresso(kits), clientes: clientes.length }
  }, [clientes])

  const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
      <div className="rounded-xl border border-hairline bg-white p-4 shadow-lift-1">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-mute">Total a faturar</p>
        <p className="mt-1 truncate text-2xl font-semibold font-tabular text-ink">{formatMoney(resumo?.valor_total)}</p>
        <p className="mt-0.5 text-xs text-ink-mute">
          {plural(dados.clientes, 'cliente', 'clientes')} · {plural(dados.geral.necessarios, 'documento', 'documentos')}
        </p>
      </div>

      {(['completo', 'em_andamento', 'nao_iniciado'] as SituacaoKit[]).map((situacao) => {
        const info = SITUACAO_INFO[situacao]
        const d = dados.porSituacao[situacao]
        const selecionado = ativo === situacao
        return (
          <button
            key={situacao}
            type="button"
            onClick={() => onSelecionar(selecionado ? null : situacao)}
            aria-pressed={selecionado}
            title={selecionado ? 'Clique para limpar o filtro' : `Mostrar só os kits ${info.label.toLowerCase()}`}
            className={cn(
              'rounded-xl border p-4 text-left shadow-lift-1 transition-colors',
              selecionado ? info.kpiAtivo : info.kpi,
            )}
          >
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-mute">{info.label}</p>
            <p className={cn('mt-1 text-2xl font-semibold font-tabular', info.numero)}>{d.kits}</p>
            <p className="mt-0.5 truncate text-xs text-ink-mute">
              {situacao === 'completo'
                ? <><span className="font-tabular">{formatMoney(d.valor)}</span> {info.descricao}</>
                : info.descricao}
            </p>
          </button>
        )
      })}

      <div className="col-span-2 rounded-xl border border-hairline bg-white p-4 shadow-lift-1 md:col-span-1">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-mute">Progresso geral</p>
        <p className="mt-1 text-2xl font-semibold font-tabular text-ink">{dados.geral.pct}%</p>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-pill bg-canvas-soft" role="progressbar" aria-valuenow={dados.geral.pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-pill bg-emerald-500 transition-[width]" style={{ width: `${dados.geral.pct}%` }} />
        </div>
        <p className="mt-1 text-xs text-ink-mute font-tabular">
          {dados.geral.emitidos}/{dados.geral.necessarios} documentos emitidos
        </p>
      </div>
    </div>
  )
}
