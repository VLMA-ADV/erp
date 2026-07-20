'use client'

// Painel lateral do Pipeline (mock 2 do cliente, 20/07): indicadores da etapa
// selecionada (valor total × ponderado pela temperatura), mapa de localidades
// e quebras Por cliente / Por área / Por pessoa / Por produto.
import { useMemo } from 'react'

export interface RailCard {
  id: string
  cliente_nome?: string | null
  valor: number
  etapa: string
  temperatura_pct?: number | null
  responsavel_interno_nome?: string | null
  area_id?: string | null
  produto_nome?: string | null
  servico_nome?: string | null
  estado?: string | null
}

const CORES = ['#E8871E', '#7C3AED', '#059669', '#2563EB', '#DB2777', '#0891B2']

// Tile-grid aproximado do Brasil (coluna, linha) — norte no topo, sul embaixo.
const UF_POS: Record<string, [number, number]> = {
  RR: [3, 0], AP: [4, 0],
  AM: [2, 1], PA: [3, 1], MA: [4, 1], CE: [5, 1], RN: [6, 1],
  AC: [1, 2], RO: [2, 2], TO: [3, 2], PI: [4, 2], PE: [5, 2], PB: [6, 2],
  MT: [2, 3], DF: [3, 3], BA: [4, 3], SE: [5, 3], AL: [6, 3],
  MS: [2, 4], GO: [3, 4], MG: [4, 4], ES: [5, 4],
  PR: [2, 5], SP: [3, 5], RJ: [4, 5],
  SC: [2, 6],
  RS: [2, 7],
}

const money = (v: number | null | undefined) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(Number(v || 0))

function Quebra({ titulo, grupos }: { titulo: string; grupos: Array<{ label: string; valor: number }> }) {
  const total = Math.max(1, grupos.reduce((s, g) => s + g.valor, 0))
  return (
    <div className="rounded-xl border border-hairline bg-white p-4">
      <p className="mb-2 text-sm font-semibold text-ink">{titulo}</p>
      {grupos.length === 0 ? (
        <p className="text-xs text-ink-mute">—</p>
      ) : (
        <ul className="space-y-1.5">
          {grupos.slice(0, 4).map((g, i) => (
            <li key={g.label} className="text-xs">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: CORES[i % CORES.length] }} />
                <span className="min-w-0 flex-1 truncate text-ink-secondary" title={g.label}>{g.label}</span>
                <span className="shrink-0 font-tabular font-medium text-ink">{money(g.valor)}</span>
                <span className="w-8 shrink-0 text-right text-ink-mute">{Math.round((g.valor / total) * 100)}%</span>
              </div>
              <div className="mt-1 h-1 rounded-full bg-secondary">
                <div className="h-1 rounded-full" style={{ width: `${(g.valor / total) * 100}%`, backgroundColor: CORES[i % CORES.length] }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function CrmPipelineRail({
  cards,
  etapaSelecionada,
  etapaLabel,
  areaNomeById,
}: {
  cards: RailCard[]
  etapaSelecionada: string
  etapaLabel: string
  areaNomeById: Map<string, string>
}) {
  const daEtapa = useMemo(() => cards.filter((c) => c.etapa === etapaSelecionada), [cards, etapaSelecionada])

  const indicadores = useMemo(() => {
    const total = daEtapa.reduce((s, c) => s + Number(c.valor || 0), 0)
    const ponderado = daEtapa.reduce((s, c) => s + Number(c.valor || 0) * (Number(c.temperatura_pct || 0) / 100), 0)
    return { total, ponderado, count: daEtapa.length }
  }, [daEtapa])

  const localidades = useMemo(() => {
    const porUf = new Map<string, { count: number; valor: number }>()
    let semUf = 0
    for (const c of daEtapa) {
      const uf = (c.estado || '').trim().toUpperCase()
      if (!uf || !(uf in UF_POS)) {
        semUf += 1
        continue
      }
      const atual = porUf.get(uf) || { count: 0, valor: 0 }
      atual.count += 1
      atual.valor += Number(c.valor || 0)
      porUf.set(uf, atual)
    }
    const max = Math.max(1, ...Array.from(porUf.values()).map((l) => l.count))
    return { porUf, semUf, max }
  }, [daEtapa])

  const quebras = useMemo(() => {
    const grupo = (chave: (c: RailCard) => string) => {
      const m = new Map<string, number>()
      for (const c of daEtapa) {
        const k = chave(c)
        m.set(k, (m.get(k) || 0) + Number(c.valor || 0))
      }
      return Array.from(m.entries())
        .map(([label, valor]) => ({ label, valor }))
        .sort((a, b) => b.valor - a.valor)
    }
    return {
      porCliente: grupo((c) => c.cliente_nome || 'Sem cliente'),
      porArea: grupo((c) => (c.area_id && areaNomeById.get(c.area_id)) || 'Sem centro de custo'),
      porPessoa: grupo((c) => c.responsavel_interno_nome || 'Sem responsável'),
      porProduto: grupo((c) => c.produto_nome || c.servico_nome || 'Sem produto'),
    }
  }, [daEtapa, areaNomeById])

  return (
    <aside className="w-full shrink-0 space-y-3 xl:w-[340px]">
      <div className="rounded-xl border border-hairline bg-white p-4">
        <p className="text-eyebrow">Indicadores da etapa</p>
        <p className="mt-1 flex items-center gap-2 text-sm font-semibold text-ink">
          {etapaLabel}
          <span className="rounded-full bg-[#FFF3E4] px-2 py-0.5 text-[11px] font-medium text-[#B45309]">{indicadores.count} ops</span>
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-hairline p-3">
            <p className="text-[10px] uppercase tracking-wide text-ink-mute">Valor total</p>
            <p className="mt-1 text-lg font-semibold font-tabular text-ink">{money(indicadores.total)}</p>
          </div>
          <div className="rounded-lg bg-[#FFF3E4] p-3">
            <p className="text-[10px] uppercase tracking-wide text-[#B45309]">Valor ponderado</p>
            <p className="mt-1 text-lg font-semibold font-tabular text-[#B45309]">{money(indicadores.ponderado)}</p>
          </div>
        </div>
        <p className="mt-2 text-[11px] leading-snug text-ink-mute">
          Ponderado = valor da oportunidade × temperatura. Ex.: temperatura 30% conta 30% do valor.
        </p>
      </div>

      <div className="rounded-xl border border-hairline bg-white p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="text-sm font-semibold text-ink">Localidades</p>
          {localidades.semUf > 0 ? (
            <span className="text-[11px] text-ink-mute">{localidades.semUf} sem cidade definida</span>
          ) : null}
        </div>
        <div className="grid w-fit gap-1" style={{ gridTemplateColumns: 'repeat(7, 26px)', gridAutoRows: '26px' }}>
          {Object.entries(UF_POS).map(([uf, [col, row]]) => {
            const item = localidades.porUf.get(uf)
            const intensity = item ? 0.25 + 0.75 * (item.count / localidades.max) : 0
            return (
              <div
                key={uf}
                title={item ? `${uf}: ${item.count} oportunidade(s) · ${money(item.valor)}` : `${uf}: 0`}
                className="flex items-center justify-center rounded text-[9px] font-medium"
                style={{
                  gridColumnStart: col,
                  gridRowStart: row + 1,
                  backgroundColor: item ? `rgba(232,135,30,${intensity})` : '#f3f4f6',
                  color: item && intensity > 0.6 ? '#fff' : '#6b7280',
                }}
              >
                {uf}
              </div>
            )
          })}
        </div>
      </div>

      <Quebra titulo="Por cliente" grupos={quebras.porCliente} />
      <Quebra titulo="Por área" grupos={quebras.porArea} />
      <Quebra titulo="Por pessoa" grupos={quebras.porPessoa} />
      <Quebra titulo="Por produto" grupos={quebras.porProduto} />
    </aside>
  )
}
