'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { DonutBreakdown } from '@/components/ui/donut-breakdown'

const ANO = 2026

interface AreaRow { nome: string; pessoas: number; projetos: number; progresso: number }
interface FaixaRow { nome: string; ordem: number; codigo: string; total: number }
interface RankRow { nome: string; progresso: number }
interface ScatterPt { progresso: number; auto: number | null }
interface AreaDet { nome: string; pessoas: { pessoa: string }[] }
interface Consolidado {
  ano: number
  kpis: { areas: number; pessoas: number; projetos: number; progresso_medio: number; feedback_realizado: number; pendentes: number }
  onde_atuar: { criticos: number; em_risco: number; discrepancias: number; a_melhorar: number }
  por_area: AreaRow[]
  por_hierarquia: { nome: string; progresso: number }[]
  por_faixa: FaixaRow[]
  status_projetos: { feedback_realizado: number; pendente: number }
  ranking: RankRow[]
  scatter: ScatterPt[]
  areas_detalhe: AreaDet[]
}

const FAIXA_COLOR: Record<string, string> = {
  baixa_performance: '#dc2626',
  a_melhorar: '#f59e0b',
  dentro_da_media: '#1E1423',
  acima_do_esperado: '#FF9900',
  fora_da_curva: '#059669',
}

function progressoColor(p: number): string {
  if (p < 30) return '#dc2626'
  if (p < 60) return '#f59e0b'
  if (p < 80) return '#84cc16'
  return '#059669'
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-hairline bg-card p-4 ${className}`}>{children}</div>
}

function HBars({ rows, max, colorFor }: { rows: { nome: string; valor: number }[]; max: number; colorFor?: (v: number) => string }) {
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.nome} className="flex items-center gap-2 text-xs">
          <span className="w-40 shrink-0 truncate text-ink-secondary" title={r.nome}>{r.nome}</span>
          <div className="h-3 flex-1 overflow-hidden rounded-full bg-secondary">
            <div className="h-full rounded-full" style={{ width: `${max > 0 ? (r.valor / max) * 100 : 0}%`, background: colorFor ? colorFor(r.valor) : '#7A5CE0' }} />
          </div>
          <span className="w-12 shrink-0 text-right font-tabular font-medium text-ink">{r.valor}{colorFor ? '%' : ''}</span>
        </li>
      ))}
    </ul>
  )
}

export default function PdiConsolidado() {
  const [data, setData] = useState<Consolidado | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [openArea, setOpenArea] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setLoading(true); setError(null)
      const supabase = createClient()
      const { data: res, error: err } = await supabase.rpc('get_pdi_consolidado', { p_ano: ANO })
      if (err) { setError(err.message); return }
      setData(res as Consolidado)
    } catch (e) { setError((e as Error).message) } finally { setLoading(false) }
  }, [])

  useEffect(() => { void load() }, [load])

  const faixaDonut = useMemo(() => (data?.por_faixa || []).map((f) => ({ label: f.nome, count: f.total })), [data])

  if (loading) return <p className="text-sm text-ink-mute">Carregando consolidação…</p>
  if (error) return <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>
  if (!data) return null

  const k = data.kpis
  const kpiCards = [
    { label: 'Áreas', value: k.areas, sub: 'departamentos' },
    { label: 'Pessoas', value: k.pessoas, sub: 'colaboradores' },
    { label: 'Projetos/Ações', value: k.projetos, sub: 'metas do PDI' },
    { label: 'Progresso médio', value: `${k.progresso_medio}%`, sub: 'média geral' },
    { label: 'Feedbacks realizados', value: k.feedback_realizado, sub: `de ${k.feedback_realizado + k.pendentes}` },
    { label: 'Pendentes', value: k.pendentes, sub: 'aguardando feedback' },
  ]
  const oa = data.onde_atuar
  const ondeAtuar = [
    { label: 'Críticos', value: oa.criticos, hint: '< 30% de progresso', color: '#dc2626' },
    { label: 'Em risco', value: oa.em_risco, hint: '30–60%', color: '#f59e0b' },
    { label: 'Discrepâncias', value: oa.discrepancias, hint: '“Acima” mas < 50%', color: '#7A5CE0' },
    { label: 'A melhorar', value: oa.a_melhorar, hint: 'autoavaliação a melhorar', color: '#b45309' },
  ]

  const areaMax = Math.max(100, ...data.por_area.map((a) => a.progresso))
  const hierMax = Math.max(100, ...data.por_hierarquia.map((h) => h.progresso))
  const rankMax = Math.max(100, ...data.ranking.map((r) => r.progresso))

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {kpiCards.map((c) => (
          <Card key={c.label}>
            <p className="text-eyebrow">{c.label}</p>
            <p className="mt-1 font-tabular text-3xl font-light text-ink">{c.value}</p>
            <p className="mt-0.5 text-xs text-ink-mute">{c.sub}</p>
          </Card>
        ))}
      </div>

      {/* Onde atuar */}
      <div>
        <p className="text-eyebrow mb-2">Onde atuar prioritariamente</p>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {ondeAtuar.map((c) => (
            <Card key={c.label} className="border-l-4" >
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-ink">{c.label}</p>
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: c.color }} />
              </div>
              <p className="mt-1 font-tabular text-3xl font-light text-ink">{c.value}</p>
              <p className="mt-0.5 text-xs text-ink-mute">{c.hint}</p>
            </Card>
          ))}
        </div>
      </div>

      {/* gráficos */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Card>
          <p className="text-eyebrow mb-3">Progresso médio por área</p>
          <HBars rows={data.por_area.map((a) => ({ nome: a.nome, valor: a.progresso }))} max={areaMax} colorFor={progressoColor} />
        </Card>
        <Card>
          <p className="text-eyebrow mb-3">Progresso médio por hierarquia</p>
          <HBars rows={data.por_hierarquia.map((h) => ({ nome: h.nome, valor: h.progresso }))} max={hierMax} colorFor={progressoColor} />
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Card>
          <p className="text-eyebrow mb-3">Distribuição por faixa (autoavaliação)</p>
          <ul className="space-y-2">
            {data.por_faixa.map((f) => {
              const max = Math.max(1, ...data.por_faixa.map((x) => x.total))
              return (
                <li key={f.codigo} className="flex items-center gap-2 text-xs">
                  <span className="w-32 shrink-0 truncate text-ink-secondary">{f.nome}</span>
                  <div className="h-3 flex-1 overflow-hidden rounded-full bg-secondary">
                    <div className="h-full rounded-full" style={{ width: `${(f.total / max) * 100}%`, background: FAIXA_COLOR[f.codigo] || '#7A5CE0' }} />
                  </div>
                  <span className="w-8 shrink-0 text-right font-tabular font-medium text-ink">{f.total}</span>
                </li>
              )
            })}
          </ul>
        </Card>
        <DonutBreakdown titulo="Status dos feedbacks" grupos={[
          { label: 'Realizado', count: data.status_projetos.feedback_realizado },
          { label: 'Pendente', count: data.status_projetos.pendente },
        ]} />
        <Card>
          <p className="text-eyebrow mb-3">Autoavaliação × progresso</p>
          <ScatterChart pts={data.scatter} />
        </Card>
      </div>

      {/* ranking + accordion */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Card>
          <p className="text-eyebrow mb-3">Ranking — pessoas (progresso médio)</p>
          <div className="max-h-80 overflow-y-auto pr-1">
            <HBars rows={data.ranking.map((r) => ({ nome: r.nome, valor: r.progresso }))} max={rankMax} colorFor={progressoColor} />
          </div>
        </Card>
        <Card>
          <p className="text-eyebrow mb-3">Por área</p>
          <div className="divide-y divide-hairline">
            {data.por_area.map((a) => {
              const det = data.areas_detalhe.find((d) => d.nome === a.nome)
              const open = openArea === a.nome
              return (
                <div key={a.nome}>
                  <button type="button" onClick={() => setOpenArea(open ? null : a.nome)} className="flex w-full items-center justify-between gap-2 py-2.5 text-left">
                    <span className="text-sm font-medium text-ink">{a.nome}</span>
                    <span className="flex items-center gap-3 text-xs text-ink-mute">
                      <span>{a.pessoas} pessoas · {a.projetos} projetos</span>
                      <span className="font-tabular font-semibold" style={{ color: progressoColor(a.progresso) }}>{a.progresso}%</span>
                    </span>
                  </button>
                  {open && det ? (
                    <ul className="pb-2 pl-1 text-xs text-ink-secondary">
                      {det.pessoas.map((p, i) => <li key={i} className="py-0.5">· {p.pessoa}</li>)}
                    </ul>
                  ) : null}
                </div>
              )
            })}
          </div>
        </Card>
      </div>
    </div>
  )
}

function ScatterChart({ pts }: { pts: ScatterPt[] }) {
  const valid = pts.filter((p) => p.auto != null)
  if (valid.length === 0) return <p className="text-sm text-ink-mute">Sem dados.</p>
  const W = 260, H = 160, padL = 28, padB = 22
  const x = (prog: number) => padL + (prog / 100) * (W - padL - 8)
  const y = (auto: number) => (H - padB) - ((auto - 1) / 4) * (H - padB - 8)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      {[0, 25, 50, 75, 100].map((g) => (
        <line key={g} x1={x(g)} y1={8} x2={x(g)} y2={H - padB} stroke="hsl(var(--hairline))" strokeWidth={0.5} />
      ))}
      {[1, 2, 3, 4, 5].map((a) => (
        <line key={a} x1={padL} y1={y(a)} x2={W - 8} y2={y(a)} stroke="hsl(var(--hairline))" strokeWidth={0.5} />
      ))}
      {valid.map((p, i) => (
        <circle key={i} cx={x(p.progresso)} cy={y(p.auto as number)} r={3.5} fill="#7A5CE0" opacity={0.7} />
      ))}
      <text x={padL} y={H - 6} className="fill-ink-mute" fontSize={7}>0%</text>
      <text x={W - 20} y={H - 6} className="fill-ink-mute" fontSize={7}>100%</text>
    </svg>
  )
}
