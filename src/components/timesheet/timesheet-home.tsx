'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { SectionTabs } from '@/components/ui/section-tabs'
import TimesheetList from './timesheet-list'
import GestaoHorasDashboard from './gestao-horas-dashboard'

interface LinhaMin {
  label: string
  minutos: number
}
interface SerieDia {
  d: string
  min: number
}
interface Resumo {
  perfil?: { nome?: string | null; foto_url?: string | null } | null
  hoje_min: number
  semana_min: number
  mes_min: number
  mes_aprovadas_min: number
  media_dia_util_min: number
  top_cliente?: string | null
  serie_dia: SerieDia[]
  por_cliente: LinhaMin[]
  por_caso: LinhaMin[]
}

// "2h40min" / "8h" / "45min" — padrão do mock do cliente.
export function fmtMin(totalMinutos: number | null | undefined) {
  const parsed = Math.max(0, Math.floor(Number(totalMinutos || 0)))
  const h = Math.floor(parsed / 60)
  const m = parsed % 60
  if (h && m) return `${h}h${String(m).padStart(2, '0')}min`
  if (h) return `${h}h`
  return `${m}min`
}

function saudacao() {
  const h = new Date().getHours()
  if (h < 12) return 'Bom dia'
  if (h < 18) return 'Boa tarde'
  return 'Boa noite'
}

// Primeiro(s) nome(s): "Maria Eduarda Pelegrini" → "Maria Eduarda".
function nomeExibicao(nome: string) {
  const particulas = new Set(['de', 'da', 'do', 'das', 'dos', 'e'])
  const partes = nome.trim().split(/\s+/).filter(Boolean)
  if (partes.length === 0) return nome
  if (partes.length > 1 && !particulas.has(partes[1].toLowerCase())) return `${partes[0]} ${partes[1]}`
  return partes[0]
}

const TREEMAP_COLORS = ['#E8871E', '#7C3AED', '#0E9F6E', '#2563EB', '#DB2777']

// Blocos proporcionais estilo treemap: maior bloco à esquerda, demais
// empilhados à direita (layout do mock).
function Treemap({ titulo, subtitulo, linhas }: { titulo: string; subtitulo: string; linhas: LinhaMin[] }) {
  const blocos = useMemo(() => {
    const validos = linhas.filter((l) => Number(l.minutos) > 0)
    const top = validos.slice(0, 4)
    const resto = validos.slice(4).reduce((s, l) => s + Number(l.minutos), 0)
    if (resto > 0) top.push({ label: 'Outros', minutos: resto })
    const total = top.reduce((s, l) => s + Number(l.minutos), 0)
    return { top, total }
  }, [linhas])

  const { top, total } = blocos
  const pct = (m: number) => Math.round((m / Math.max(total, 1)) * 100)
  const leftPct = top.length > 1 ? Math.min(68, Math.max(34, (Number(top[0]?.minutos) / Math.max(total, 1)) * 100)) : 100

  return (
    <div className="rounded-xl border border-hairline bg-card p-4">
      <p className="text-sm font-semibold text-ink">{titulo}</p>
      <p className="mb-3 text-xs text-ink-mute">{subtitulo}</p>
      {top.length === 0 ? (
        <div className="flex h-[200px] items-center justify-center rounded-lg bg-canvas-soft text-sm text-ink-mute">
          Sem horas lançadas no mês
        </div>
      ) : (
        <div className="flex h-[200px] gap-1 overflow-hidden rounded-lg">
          <div
            className="flex flex-col justify-start p-3"
            style={{ width: `${leftPct}%`, backgroundColor: TREEMAP_COLORS[0] }}
          >
            <p className="truncate text-xs font-semibold text-white" title={top[0].label}>{top[0].label}</p>
            <p className="text-[11px] text-white/85">{fmtMin(top[0].minutos)} · {pct(Number(top[0].minutos))}%</p>
          </div>
          {top.length > 1 ? (
            <div className="flex flex-1 flex-col gap-1">
              {top.slice(1).map((l, i) => (
                <div
                  key={l.label}
                  className="flex min-h-0 flex-col justify-start overflow-hidden p-3"
                  style={{
                    flexGrow: Math.max(Number(l.minutos), 1),
                    backgroundColor: TREEMAP_COLORS[(i + 1) % TREEMAP_COLORS.length],
                  }}
                >
                  <p className="truncate text-xs font-semibold text-white" title={l.label}>{l.label}</p>
                  <p className="text-[11px] text-white/85">{fmtMin(l.minutos)} · {pct(Number(l.minutos))}%</p>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}

// Horas lançadas por dia (pontos com rótulo nos dias com lançamento).
function ChartHoras({ serie }: { serie: SerieDia[] }) {
  const [modo, setModo] = useState<'semana' | 'mes'>('mes')

  const chart = useMemo(() => {
    const hoje = new Date()
    const byDay = new Map(serie.map((s) => [s.d, Number(s.min) || 0]))
    const iso = (dt: Date) =>
      `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`

    let dias: Date[] = []
    if (modo === 'mes') {
      const last = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).getDate()
      dias = Array.from({ length: last }, (_, i) => new Date(hoje.getFullYear(), hoje.getMonth(), i + 1))
    } else {
      const seg = new Date(hoje)
      seg.setDate(hoje.getDate() - ((hoje.getDay() + 6) % 7))
      dias = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(seg)
        d.setDate(seg.getDate() + i)
        return d
      })
    }

    // Horas DO DIA (sem acumular) — pedido Filipe 21/07.
    const pontos = dias.map((d, i) => {
      const passado = d.getTime() <= hoje.getTime()
      const min = byDay.get(iso(d)) || 0
      return { i, d, passado, temLancamento: passado && min > 0, cum: passado ? min : null }
    })
    const yMax = Math.max(...pontos.map((p) => p.cum || 0), 60)
    const mesLabel = hoje.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
    return { dias, pontos, yMax, mesLabel }
  }, [serie, modo])

  const W = 860
  const H = 230
  const padL = 10
  const padR = 26
  const padT = 30
  const padB = 26
  const n = chart.dias.length
  const x = (i: number) => padL + (i / Math.max(n - 1, 1)) * (W - padL - padR)
  const y = (v: number) => padT + (1 - v / chart.yMax) * (H - padT - padB)

  const passados = chart.pontos.filter((p) => p.passado)
  const linePath = passados.map((p, idx) => `${idx === 0 ? 'M' : 'L'}${x(p.i).toFixed(1)},${y(p.cum || 0).toFixed(1)}`).join(' ')
  const areaPath = passados.length > 1
    ? `${linePath} L${x(passados[passados.length - 1].i).toFixed(1)},${(H - padB).toFixed(1)} L${x(passados[0].i).toFixed(1)},${(H - padB).toFixed(1)} Z`
    : ''

  const mesLabel = chart.mesLabel
  const ultimoDia = chart.dias.length

  return (
    <div className="rounded-xl border border-hairline bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-ink">Horas lançadas</p>
          <p className="text-xs capitalize text-ink-mute">
            {modo === 'mes' ? `${mesLabel} · horas por dia (1 a ${ultimoDia})` : 'Semana atual · horas por dia'}
          </p>
        </div>
        <div className="flex rounded-full border border-hairline bg-canvas-soft p-0.5 text-xs">
          {(['semana', 'mes'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setModo(m)}
              className={`rounded-full px-3 py-1 capitalize transition ${modo === m ? 'bg-white font-medium text-ink shadow-sm' : 'text-ink-mute'}`}
            >
              {m === 'mes' ? 'Mês' : 'Semana'}
            </button>
          ))}
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 w-full" role="img" aria-label="Horas lançadas acumuladas">
        {chart.dias.map((_, i) => (
          <line key={i} x1={x(i)} y1={padT - 6} x2={x(i)} y2={H - padB} stroke="#eceae6" strokeWidth={1} />
        ))}
        <line x1={padL} y1={H - padB} x2={W - padR} y2={H - padB} stroke="#d9d6d0" strokeWidth={1} />
        {areaPath ? <path d={areaPath} fill="#E8871E" opacity={0.08} /> : null}
        {linePath ? <path d={linePath} fill="none" stroke="#E8871E" strokeWidth={2} /> : null}
        {passados.filter((p) => p.temLancamento).map((p) => (
          <g key={p.i}>
            <circle cx={x(p.i)} cy={y(p.cum || 0)} r={4.5} fill="#fff" stroke="#E8871E" strokeWidth={2} />
            <text x={x(p.i)} y={y(p.cum || 0) - 10} textAnchor="middle" fontSize={11} fontWeight={600} fill="#E8871E">
              {fmtMin(p.cum)}
            </text>
          </g>
        ))}
        {chart.dias.map((d, i) => {
          if (modo === 'mes' && i % 2 !== 0) return null
          const label = modo === 'mes'
            ? String(d.getDate()).padStart(2, '0')
            : d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '')
          return (
            <text key={`l-${i}`} x={x(i)} y={H - padB + 16} textAnchor="middle" fontSize={10} fill="#a8a29e">
              {label}
            </text>
          )
        })}
      </svg>
    </div>
  )
}

function KpiCards({ data }: { data: Resumo }) {
  const kpis: Array<{ label: string; value: string; accent?: boolean; small?: boolean }> = [
    { label: 'Hoje', value: fmtMin(data.hoje_min) },
    { label: 'Esta semana', value: fmtMin(data.semana_min) },
    { label: 'Este mês', value: fmtMin(data.mes_min) },
    { label: 'Aprovadas (mês)', value: fmtMin(data.mes_aprovadas_min), accent: true },
    { label: 'Média / dia útil', value: fmtMin(data.media_dia_util_min) },
    { label: 'Top cliente (mês)', value: data.top_cliente || '—', small: true },
  ]
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      {kpis.map((c) => (
        <div key={c.label} className="rounded-xl border border-hairline bg-card p-4">
          <p className="text-eyebrow">{c.label}</p>
          <p
            className={`mt-1 font-tabular font-light ${c.small ? 'truncate pt-1 text-sm font-medium' : 'text-2xl'} ${c.accent ? 'text-emerald-700' : 'text-ink'}`}
            title={c.small ? c.value : undefined}
          >
            {c.value}
          </p>
        </div>
      ))}
    </div>
  )
}

export default function TimesheetHome() {
  const [data, setData] = useState<Resumo | null>(null)
  const [loading, setLoading] = useState(true)
  const [fallbackNome, setFallbackNome] = useState('')

  useEffect(() => {
    const load = async () => {
      try {
        const supabase = createClient()
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) return
        setFallbackNome(session.user.email?.split('@')[0] || '')
        const { data: res, error } = await supabase.rpc('get_minhas_horas_resumo', { p_user_id: session.user.id })
        if (!error && res) setData(res as Resumo)
      } catch (err) {
        console.error(err)
      } finally {
        setLoading(false)
      }
    }
    void load()
    // KPIs/gráfico/treemaps acompanham criar/editar/excluir da lista abaixo.
    const onChanged = () => void load()
    window.addEventListener('vlma:timesheet-changed', onChanged)
    return () => window.removeEventListener('vlma:timesheet-changed', onChanged)
  }, [])

  const nome = data?.perfil?.nome ? nomeExibicao(data.perfil.nome) : fallbackNome

  // Bucket de fotos é privado: o foto_url pode vir como URL pública antiga ou já
  // como path; extrai o path e gera uma signed URL temporária para exibir.
  const [foto, setFoto] = useState<string | null>(null)
  useEffect(() => {
    const raw = data?.perfil?.foto_url || null
    if (!raw) { setFoto(null); return }
    const s = String(raw).split('?')[0]
    const marker = '/colaboradores-fotos/'
    const i = s.indexOf(marker)
    const path = i >= 0 ? s.slice(i + marker.length) : (/^https?:\/\//i.test(s) ? null : s)
    if (!path) { setFoto(raw); return }
    let cancel = false
    ;(async () => {
      try {
        const supabase = createClient()
        const { data: signed } = await supabase.storage.from('colaboradores-fotos').createSignedUrl(path, 3600)
        if (!cancel) setFoto(signed?.signedUrl || null)
      } catch { if (!cancel) setFoto(null) }
    })()
    return () => { cancel = true }
  }, [data?.perfil?.foto_url])
  const iniciais = (nome || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || '')
    .join('')

  const dashboard = loading ? (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {[1, 2, 3, 4, 5, 6].map((i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-secondary" />)}
      </div>
      <div className="h-64 animate-pulse rounded-xl bg-secondary" />
    </div>
  ) : data ? (
    <div className="space-y-4">
      <KpiCards data={data} />
      <ChartHoras serie={data.serie_dia || []} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Treemap titulo="Horas por cliente" subtitulo="Todos os clientes com horas lançadas no mês" linhas={data.por_cliente || []} />
        <Treemap titulo="Casos mais trabalhados" subtitulo="Todos os casos com horas lançadas no mês" linhas={data.por_caso || []} />
      </div>
    </div>
  ) : null

  return (
    <div>
      <header className="mb-6">
        <span className="text-eyebrow">OPERAÇÃO · TIMESHEET</span>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          {foto ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={foto} alt="" className="h-14 w-14 shrink-0 rounded-full object-cover" />
          ) : (
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-canvas-soft text-lg font-semibold text-ink-secondary">
              {iniciais || '?'}
            </span>
          )}
          <div>
            <h1 className="display-lg text-ink">
              {saudacao()}, {nome || 'colega'} <span aria-hidden>👋</span>
            </h1>
            <p className="mt-1 text-sm text-ink-mute">Lançamentos de horas por cliente e caso</p>
          </div>
        </div>
        {/* Primeira ação de quem abre o módulo (feedback 20/07) — a lista abaixo escuta o evento. */}
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event('vlma:novo-timesheet'))}
          className="inline-flex items-center gap-2 rounded-full bg-[#E8871E] px-5 py-2.5 text-sm font-medium text-white shadow-sm transition hover:opacity-90"
        >
          <span className="text-base leading-none" aria-hidden>+</span> Novo timesheet
        </button>
        </div>
      </header>
      <SectionTabs
        tabs={[
          {
            value: 'meus',
            label: 'Meus lançamentos',
            content: (
              <div className="space-y-6">
                {dashboard}
                <TimesheetList />
              </div>
            ),
          },
          { value: 'gestao', label: 'Gestão da equipe', content: <GestaoHorasDashboard /> },
        ]}
      />
    </div>
  )
}
