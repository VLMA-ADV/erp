'use client'

import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { usePermissionsContext } from '@/lib/contexts/permissions-context'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { NativeSelect } from '@/components/ui/native-select'

interface DashboardListItem {
  nome: string
  total: number
}

interface SerieTemporalItem {
  mes: string
  rotulo: string
  contratos_novos: number
  casos_novos: number
}

interface ContratosDashboardData {
  kpis: {
    contratos_ativos: number
    casos_ativos: number
    casos_novos_mes: number
    contratos_novos_mes: number
  }
  serie_temporal: SerieTemporalItem[]
  por_responsavel: DashboardListItem[]
  por_servico: DashboardListItem[]
  por_produto: DashboardListItem[]
  por_centro_custo: DashboardListItem[]
  por_regra_cobranca_mes: DashboardListItem[]
  por_cliente_top: DashboardListItem[]
  por_status: DashboardListItem[]
}

const MES_PT: Record<string, string> = {
  Jan: 'Jan', Feb: 'Fev', Mar: 'Mar', Apr: 'Abr', May: 'Mai', Jun: 'Jun',
  Jul: 'Jul', Aug: 'Ago', Sep: 'Set', Oct: 'Out', Nov: 'Nov', Dec: 'Dez',
}

// Tints de marca VLMA (quentes + ink roxo da marca, hue 280) — sem azul/verde frio
const AVATAR_COLORS = [
  { bg: '#fff1d6', fg: '#854f0b' },
  { bg: '#fef2f2', fg: '#b91c1c' },
  { bg: '#fff7ed', fg: '#c2410c' },
  { bg: '#f3eef7', fg: '#5b2e6b' },
  { bg: '#fef3c7', fg: '#b45309' },
  { bg: '#f5f5f4', fg: '#57534e' },
  { bg: '#ffe4e6', fg: '#9f1239' },
  { bg: '#fffbeb', fg: '#a16207' },
]

// Categórico de marca: laranja → ink → vermelho → tons quentes + roxo-ink
const DONUT_PALETTE = ['#FF9900', '#1E1423', '#FF3333', '#FFC266', '#B45309', '#8A5A9E', '#A8A29E']

const STATUS_LABEL: Record<string, string> = {
  ativo: 'Ativo',
  em_analise: 'Em análise',
  rascunho: 'Rascunho',
  encerrado: 'Encerrado',
  suspenso: 'Suspenso',
  'sem status': 'Sem status',
}

const STATUS_COLOR: Record<string, string> = {
  ativo: '#10b981',
  em_analise: '#f59e0b',
  rascunho: '#A8A29E',
  encerrado: '#57534e',
  suspenso: '#FF3333',
  'sem status': '#cbd5e1',
}

function rotuloPtBr(rotulo: string): string {
  const [mes, ano] = rotulo.split('/')
  return `${MES_PT[mes] || mes}/${ano}`
}

function hashIndex(text: string, mod: number): number {
  let h = 0
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0
  return Math.abs(h) % mod
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '–'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function normalizeList(value: unknown): DashboardListItem[] {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null
      const item = entry as Record<string, unknown>
      return {
        nome: typeof item.nome === 'string' ? item.nome : 'Sem nome',
        total: Number(item.total || 0),
      }
    })
    .filter((entry): entry is DashboardListItem => entry !== null)
}

function normalizeSerie(value: unknown): SerieTemporalItem[] {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null
      const item = entry as Record<string, unknown>
      return {
        mes: String(item.mes || ''),
        rotulo: String(item.rotulo || ''),
        contratos_novos: Number(item.contratos_novos || 0),
        casos_novos: Number(item.casos_novos || 0),
      }
    })
    .filter((entry): entry is SerieTemporalItem => entry !== null)
}

function KpiCard({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="rounded-xl border bg-white p-4 shadow-sm">
      <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-ink-mute">{label}</p>
      <p className="mt-2 text-3xl font-semibold leading-none text-ink font-tabular">{value.toLocaleString('pt-BR')}</p>
      {hint && <p className="mt-1 text-[10px] text-ink-mute">{hint}</p>}
    </div>
  )
}

function CardShell({ title, hint, children, className = '' }: { title: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`flex h-full flex-col rounded-xl border bg-white p-4 shadow-sm ${className}`}>
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-ink-mute">{title}</p>
        {hint && <p className="text-[10px] text-ink-mute">{hint}</p>}
      </div>
      <div className="flex-1">{children}</div>
    </div>
  )
}

function StackedAreaChart({ serie }: { serie: SerieTemporalItem[] }) {
  const width = 800
  const height = 220
  const padding = { top: 20, right: 16, bottom: 32, left: 36 }
  const innerW = width - padding.left - padding.right
  const innerH = height - padding.top - padding.bottom

  const stacked = serie.map((s) => ({ ...s, total: s.contratos_novos + s.casos_novos }))
  const max = Math.max(1, ...stacked.map((s) => s.total))
  const yTicks = [0, Math.ceil(max / 2), max]

  const xStep = stacked.length > 1 ? innerW / (stacked.length - 1) : 0
  const xCoord = (i: number) => padding.left + i * xStep
  const yCoord = (v: number) => padding.top + innerH - (v / max) * innerH

  const buildArea = (key: 'lower' | 'upper') => {
    const top = stacked.map((s, i) => {
      const y = key === 'lower' ? yCoord(s.contratos_novos) : yCoord(s.contratos_novos + s.casos_novos)
      return `${i === 0 ? 'M' : 'L'} ${xCoord(i)} ${y}`
    }).join(' ')
    const bottom = stacked.map((s, i) => {
      const idx = stacked.length - 1 - i
      const y = key === 'lower' ? yCoord(0) : yCoord(stacked[idx].contratos_novos)
      return `L ${xCoord(idx)} ${y}`
    }).join(' ')
    return `${top} ${bottom} Z`
  }

  const lineCasos = stacked.map((s, i) => `${i === 0 ? 'M' : 'L'} ${xCoord(i)} ${yCoord(s.contratos_novos + s.casos_novos)}`).join(' ')
  const lineContratos = stacked.map((s, i) => `${i === 0 ? 'M' : 'L'} ${xCoord(i)} ${yCoord(s.contratos_novos)}`).join(' ')

  return (
    <div className="flex h-full flex-col rounded-xl border bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-ink-mute">Tempo × volume</p>
          <p className="text-sm text-ink">Volume mensal acumulado (12 meses)</p>
        </div>
        <div className="flex gap-3 text-[11px]">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: '#FF9900' }} />
            <span className="text-ink-mute">Casos</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: '#1E1423' }} />
            <span className="text-ink-mute">Contratos</span>
          </span>
        </div>
      </div>
      <div className="relative w-full overflow-hidden">
        <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" preserveAspectRatio="none">
          <defs>
            <linearGradient id="grad-contratos" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#1E1423" stopOpacity={0.55} />
              <stop offset="100%" stopColor="#1E1423" stopOpacity={0.06} />
            </linearGradient>
            <linearGradient id="grad-casos" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#FF9900" stopOpacity={0.55} />
              <stop offset="100%" stopColor="#FF9900" stopOpacity={0.06} />
            </linearGradient>
          </defs>
          {yTicks.map((t) => (
            <g key={`grid-${t}`}>
              <line x1={padding.left} x2={width - padding.right} y1={yCoord(t)} y2={yCoord(t)} stroke="#e2e8f0" strokeWidth={1} strokeDasharray="2 4" vectorEffect="non-scaling-stroke" />
              <text x={padding.left - 6} y={yCoord(t) + 3} textAnchor="end" className="fill-ink-mute text-[10px] font-tabular">{t}</text>
            </g>
          ))}
          <path d={buildArea('upper')} fill="url(#grad-casos)" />
          <path d={buildArea('lower')} fill="url(#grad-contratos)" />
          <path d={lineCasos} fill="none" stroke="#FF9900" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          <path d={lineContratos} fill="none" stroke="#1E1423" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          {stacked.map((s, i) => (
            <g key={`pts-${s.mes}`}>
              {s.contratos_novos + s.casos_novos > 0 && (
                <text x={xCoord(i)} y={yCoord(s.contratos_novos + s.casos_novos) - 6} textAnchor="middle" className="fill-ink text-[10px] font-tabular font-medium">
                  {s.contratos_novos + s.casos_novos}
                </text>
              )}
              <text x={xCoord(i)} y={height - 10} textAnchor="middle" className="fill-ink-mute text-[10px]">{rotuloPtBr(s.rotulo)}</text>
            </g>
          ))}
        </svg>
      </div>
    </div>
  )
}

function AvatarBarChart({ title, items, hint, onSelect }: { title: string; items: DashboardListItem[]; hint?: string; onSelect?: (nome: string) => void }) {
  const top = items.slice(0, 6)
  const max = top.reduce((acc, item) => Math.max(acc, item.total), 0)
  return (
    <CardShell title={title} hint={hint}>
      <div className="space-y-2.5">
        {top.length === 0 ? (
          <p className="text-xs text-ink-mute">Sem dados</p>
        ) : (
          top.map((item, idx) => {
            const width = max > 0 ? (item.total / max) * 100 : 0
            const palette = AVATAR_COLORS[hashIndex(item.nome, AVATAR_COLORS.length)]
            const isUnassigned = /sem responsável|sem nome/i.test(item.nome)
            return (
              <div
                key={`${title}-${item.nome}-${idx}`}
                className={`space-y-1 ${onSelect ? 'cursor-pointer rounded-md p-1 -m-1 hover:bg-canvas-soft' : ''}`}
                onClick={onSelect ? () => onSelect(item.nome) : undefined}
                title={onSelect ? 'Ver contratos' : undefined}
              >
                <div className="flex items-center gap-2">
                  <span
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold"
                    style={{ background: isUnassigned ? '#f1f5f9' : palette.bg, color: isUnassigned ? '#64748b' : palette.fg }}
                  >
                    {isUnassigned ? '?' : initials(item.nome)}
                  </span>
                  <span className="flex-1 truncate text-[12px] text-ink" title={item.nome}>{item.nome}</span>
                  <span className="text-[12px] font-medium text-ink font-tabular">{item.total}</span>
                </div>
                <div className="ml-8 h-1.5 rounded-full bg-canvas-soft">
                  <div
                    className="h-1.5 rounded-full transition-all"
                    style={{ width: `${width}%`, background: isUnassigned ? '#94a3b8' : palette.fg }}
                  />
                </div>
              </div>
            )
          })
        )}
      </div>
    </CardShell>
  )
}

function DonutChart({ title, items, hint, maxSlices = 6, onSelect }: { title: string; items: DashboardListItem[]; hint?: string; maxSlices?: number; onSelect?: (nome: string) => void }) {
  if (items.length === 0) {
    return (
      <CardShell title={title} hint={hint}>
        <p className="text-xs text-ink-mute">Sem dados</p>
      </CardShell>
    )
  }
  const sorted = [...items].sort((a, b) => b.total - a.total)
  const head = sorted.slice(0, maxSlices)
  const tail = sorted.slice(maxSlices)
  const outros = tail.reduce((acc, i) => acc + i.total, 0)
  const slices = outros > 0 ? [...head, { nome: 'Outros', total: outros }] : head
  const total = slices.reduce((acc, i) => acc + i.total, 0)

  const size = 132
  const r = 54
  const cx = size / 2
  const cy = size / 2
  const circ = 2 * Math.PI * r
  let offset = 0

  return (
    <CardShell title={title} hint={hint}>
      <div className="flex items-center gap-4">
        <div className="relative shrink-0">
          <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
            <circle cx={cx} cy={cy} r={r} fill="none" stroke="#f1f5f9" strokeWidth={18} />
            {slices.map((s, i) => {
              const frac = total > 0 ? s.total / total : 0
              const dash = frac * circ
              const color = s.nome === 'Outros' ? '#cbd5e1' : DONUT_PALETTE[i % DONUT_PALETTE.length]
              const el = (
                <circle
                  key={`${s.nome}-${i}`}
                  cx={cx}
                  cy={cy}
                  r={r}
                  fill="none"
                  stroke={color}
                  strokeWidth={18}
                  strokeDasharray={`${dash} ${circ - dash}`}
                  strokeDashoffset={-offset}
                  transform={`rotate(-90 ${cx} ${cy})`}
                />
              )
              offset += dash
              return el
            })}
            <text x={cx} y={cy - 2} textAnchor="middle" className="fill-ink text-[18px] font-semibold font-tabular">{total}</text>
            <text x={cx} y={cy + 14} textAnchor="middle" className="fill-ink-mute text-[9px] uppercase tracking-wider">total</text>
          </svg>
        </div>
        <div className="flex-1 space-y-1.5">
          {slices.map((s, i) => {
            const color = s.nome === 'Outros' ? '#cbd5e1' : DONUT_PALETTE[i % DONUT_PALETTE.length]
            const pct = total > 0 ? Math.round((s.total / total) * 100) : 0
            const clickable = onSelect && s.nome !== 'Outros'
            return (
              <div
                key={`leg-${s.nome}-${i}`}
                className={`flex items-center gap-2 text-[11px] ${clickable ? 'cursor-pointer rounded hover:bg-canvas-soft' : ''}`}
                onClick={clickable ? () => onSelect!(s.nome) : undefined}
                title={clickable ? 'Ver contratos' : undefined}
              >
                <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: color }} />
                <span className="flex-1 truncate text-ink" title={s.nome}>{s.nome}</span>
                <span className="text-ink-mute font-tabular">{pct}%</span>
                <span className="w-7 text-right font-medium text-ink font-tabular">{s.total}</span>
              </div>
            )
          })}
        </div>
      </div>
    </CardShell>
  )
}

function CentroCustoCard({ items, totalCasos, onSelect }: { items: DashboardListItem[]; totalCasos: number; onSelect?: (nome: string) => void }) {
  const semCentro = items.find((i) => /sem centro/i.test(i.nome))?.total ?? 0
  const definidos = items.filter((i) => !/sem centro/i.test(i.nome))
  const totalDefinidos = definidos.reduce((acc, i) => acc + i.total, 0)
  const totalGeral = semCentro + totalDefinidos
  const pctCadastrado = totalGeral > 0 ? Math.round((totalDefinidos / totalGeral) * 100) : 0

  if (definidos.length === 0) {
    return (
      <CardShell title="Por centro de custo" hint="cobertura de cadastro">
        <div className="flex h-full flex-col items-start justify-center gap-3">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-100 text-amber-700 text-base font-bold">!</span>
            <div>
              <p className="text-sm font-medium text-ink">Centros não cadastrados</p>
              <p className="text-[11px] text-ink-mute">
                {semCentro.toLocaleString('pt-BR')} caso{semCentro !== 1 ? 's' : ''} sem rateio
                {totalCasos > 0 && ` (${Math.min(100, Math.round((semCentro / totalCasos) * 100))}% do total)`}
              </p>
            </div>
          </div>
          <div className="w-full">
            <div className="h-2 w-full rounded-full bg-canvas-soft">
              <div className="h-2 rounded-full bg-amber-400" style={{ width: '100%' }} />
            </div>
            <p className="mt-2 text-[11px] text-ink-mute">
              Cadastre o centro de custo em cada caso para acompanhar a distribuição aqui.
            </p>
          </div>
        </div>
      </CardShell>
    )
  }

  const itemsParaDonut = semCentro > 0 ? [...definidos, { nome: 'Sem centro de custo', total: semCentro }] : definidos
  return (
    <DonutChart
      title="Por centro de custo"
      hint={`${pctCadastrado}% dos casos com centro`}
      items={itemsParaDonut}
      maxSlices={5}
      onSelect={onSelect}
    />
  )
}

function PodiumList({ title, items, hint, onSelect }: { title: string; items: DashboardListItem[]; hint?: string; onSelect?: (nome: string) => void }) {
  const top = items.slice(0, 10)
  const max = top.reduce((acc, i) => Math.max(acc, i.total), 0)
  return (
    <CardShell title={title} hint={hint}>
      <div className="space-y-1.5">
        {top.length === 0 ? (
          <p className="text-xs text-ink-mute">Sem dados</p>
        ) : (
          top.map((item, idx) => {
            const width = max > 0 ? (item.total / max) * 100 : 0
            const isPodium = idx < 3
            return (
              <div
                key={`pod-${item.nome}-${idx}`}
                className={`flex items-center gap-2 ${onSelect ? 'cursor-pointer rounded-md p-1 -m-1 hover:bg-canvas-soft' : ''}`}
                onClick={onSelect ? () => onSelect(item.nome) : undefined}
                title={onSelect ? 'Ver contratos' : undefined}
              >
                <span
                  className={`flex h-6 w-7 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold font-tabular ${
                    isPodium ? 'bg-amber-50 text-amber-800' : 'bg-canvas-soft text-ink-mute'
                  }`}
                >
                  {`${idx + 1}º`}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 text-[12px]">
                    <span className="truncate text-ink" title={item.nome}>{item.nome}</span>
                    <span className="font-medium text-ink font-tabular">{item.total}</span>
                  </div>
                  <div className="mt-1 h-1 rounded-full bg-canvas-soft">
                    <div
                      className="h-1 rounded-full"
                      style={{ width: `${width}%`, background: isPodium ? '#f59e0b' : '#cbd5e1' }}
                    />
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>
    </CardShell>
  )
}

function StatusStackedBar({ items, hint, onSelect }: { items: DashboardListItem[]; hint?: string; onSelect?: (nome: string) => void }) {
  const total = items.reduce((acc, i) => acc + i.total, 0)
  return (
    <CardShell title="Por status do contrato" hint={hint}>
      {total === 0 ? (
        <p className="text-xs text-ink-mute">Sem dados</p>
      ) : (
        <div className="space-y-3">
          <div className="flex h-7 w-full overflow-hidden rounded-md border border-hairline">
            {items.map((item) => {
              const pct = (item.total / total) * 100
              if (pct === 0) return null
              const color = STATUS_COLOR[item.nome.toLowerCase()] ?? '#94a3b8'
              return (
                <div
                  key={`stk-${item.nome}`}
                  className="flex items-center justify-center text-[10px] font-medium text-white"
                  style={{ width: `${pct}%`, background: color }}
                  title={`${STATUS_LABEL[item.nome] ?? item.nome}: ${item.total} (${pct.toFixed(1)}%)`}
                >
                  {pct > 8 ? `${Math.round(pct)}%` : ''}
                </div>
              )
            })}
          </div>
          <div className="grid grid-cols-1 gap-1.5">
            {items.map((item) => {
              const color = STATUS_COLOR[item.nome.toLowerCase()] ?? '#94a3b8'
              const pct = total > 0 ? Math.round((item.total / total) * 100) : 0
              return (
                <div
                  key={`leg-${item.nome}`}
                  className={`flex items-center gap-2 text-[11px] ${onSelect ? 'cursor-pointer rounded hover:bg-canvas-soft' : ''}`}
                  onClick={onSelect ? () => onSelect(item.nome) : undefined}
                  title={onSelect ? 'Ver contratos' : undefined}
                >
                  <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: color }} />
                  <span className="flex-1 truncate text-ink">{STATUS_LABEL[item.nome] ?? item.nome}</span>
                  <span className="text-ink-mute font-tabular">{pct}%</span>
                  <span className="w-8 text-right font-medium text-ink font-tabular">{item.total}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </CardShell>
  )
}

function DashboardSkeleton() {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="rounded-xl border bg-white p-4 shadow-sm">
            <div className="animate-pulse space-y-2">
              <div className="h-3 w-20 rounded bg-hairline" />
              <div className="h-8 w-16 rounded bg-hairline" />
            </div>
          </div>
        ))}
      </div>
      <div className="rounded-xl border bg-white p-4 shadow-sm">
        <div className="h-44 w-full animate-pulse rounded bg-hairline" />
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="h-44 animate-pulse rounded-xl border bg-white p-3 shadow-sm" />
        ))}
      </div>
    </div>
  )
}

const REGRA_LABEL: Record<string, string> = {
  projeto: 'Projeto',
  hora: 'Hora',
  mensal: 'Fixo mensal',
  mensalidade_processo: 'Mensalidade por processo',
  salario_minimo: 'Salário mínimo',
  exito: 'Êxito',
  mensalidade_carteira: 'Mensalidade de carteira',
  'Sem regra': 'Sem regra',
}

async function resolveTenantId(supabase: ReturnType<typeof createClient>): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.user?.id) return null
  const { data: tenantResult } = await supabase.rpc('get_user_tenant', { p_user_id: session.user.id })
  if (Array.isArray(tenantResult) && tenantResult[0]?.tenant_id) return String(tenantResult[0].tenant_id)
  if (tenantResult && typeof tenantResult === 'object' && 'tenant_id' in tenantResult) return String((tenantResult as Record<string, unknown>).tenant_id)
  if (typeof tenantResult === 'string') return tenantResult
  return null
}

function RegraCard({ items, onSelect }: { items: DashboardListItem[]; onSelect?: (nome: string) => void }) {
  const max = Math.max(1, ...items.map((i) => i.total))
  return (
    <CardShell title="Fechados no mês por regra de cobrança" hint="contagem no mês">
      {items.length === 0 ? (
        <p className="text-xs text-ink-mute">Nenhum caso no mês selecionado</p>
      ) : (
        <div className="space-y-1.5">
          {items.map((it) => (
            <div
              key={`regra-${it.nome}`}
              className={`space-y-1 ${onSelect ? 'cursor-pointer rounded-md p-1 -m-1 hover:bg-canvas-soft' : ''}`}
              onClick={onSelect ? () => onSelect(it.nome) : undefined}
              title={onSelect ? 'Ver contratos' : undefined}
            >
              <div className="flex items-center justify-between gap-2 text-[12px]">
                <span className="truncate text-ink">{REGRA_LABEL[it.nome] || it.nome}</span>
                <span className="font-medium text-ink font-tabular">{it.total}</span>
              </div>
              <div className="h-1.5 rounded-full bg-canvas-soft">
                <div className="h-1.5 rounded-full bg-primary" style={{ width: `${(it.total / max) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </CardShell>
  )
}

const DRILL_TITULOS: Record<string, string> = {
  por_responsavel: 'Responsável',
  por_servico: 'Serviço',
  por_produto: 'Produto',
  por_centro_custo: 'Centro de custo',
  por_cliente_top: 'Cliente',
  por_status: 'Status',
  por_regra_cobranca_mes: 'Regra de cobrança',
}

interface DrillRow { numero: number | null; nome: string; cliente: string; caso: string | null }

export default function ContratosDashboard() {
  const { hasPermission } = usePermissionsContext()
  const canRead = hasPermission('contracts.contratos.read')
  const [refMonth, setRefMonth] = useState('') // '' = mês atual; senão 'YYYY-MM'
  const [drill, setDrill] = useState<{ dim: string; valor: string } | null>(null)

  const monthOptions = useMemo(() => {
    const opts: Array<{ value: string; label: string }> = [{ value: '', label: 'Mês atual' }]
    const now = new Date()
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      opts.push({ value, label: d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }) })
    }
    return opts
  }, [])

  const { data, isLoading } = useQuery({
    queryKey: ['contracts-dashboard-v2', refMonth],
    enabled: canRead,
    queryFn: async (): Promise<ContratosDashboardData | null> => {
      try {
        const supabase = createClient()
        const tenantId = await resolveTenantId(supabase)
        if (!tenantId) return null

        const { data: raw, error } = await supabase.rpc('get_contratos_dashboard_v2', {
          p_tenant_id: tenantId,
          p_ref_month: refMonth ? `${refMonth}-01` : null,
        })
        if (error || !raw) return null

        const payload: Record<string, unknown> = typeof raw === 'string' ? JSON.parse(raw) : raw
        if (!payload || typeof payload !== 'object') return null

        const kpisRaw = (payload.kpis ?? {}) as Record<string, unknown>
        return {
          kpis: {
            contratos_ativos: Number(kpisRaw.contratos_ativos || 0),
            casos_ativos: Number(kpisRaw.casos_ativos || 0),
            casos_novos_mes: Number(kpisRaw.casos_novos_mes || 0),
            contratos_novos_mes: Number(kpisRaw.contratos_novos_mes || 0),
          },
          serie_temporal: normalizeSerie(payload.serie_temporal),
          por_responsavel: normalizeList(payload.por_responsavel),
          por_servico: normalizeList(payload.por_servico),
          por_produto: normalizeList(payload.por_produto),
          por_centro_custo: normalizeList(payload.por_centro_custo),
          por_regra_cobranca_mes: normalizeList(payload.por_regra_cobranca_mes),
          por_cliente_top: normalizeList(payload.por_cliente_top),
          por_status: normalizeList(payload.por_status),
        }
      } catch {
        return null
      }
    },
  })

  const { data: drillRows, isLoading: drillLoading } = useQuery({
    queryKey: ['contracts-dashboard-drill', drill?.dim, drill?.valor, refMonth],
    enabled: canRead && !!drill,
    queryFn: async (): Promise<DrillRow[]> => {
      if (!drill) return []
      const supabase = createClient()
      const tenantId = await resolveTenantId(supabase)
      if (!tenantId) return []
      const { data: raw, error } = await supabase.rpc('get_contratos_dashboard_drill', {
        p_tenant_id: tenantId,
        p_dim: drill.dim,
        p_valor: drill.valor,
        p_ref_month: refMonth ? `${refMonth}-01` : null,
      })
      if (error || !raw) return []
      const arr = typeof raw === 'string' ? JSON.parse(raw) : raw
      return Array.isArray(arr) ? (arr as DrillRow[]) : []
    },
  })

  if (!canRead) return null
  if (isLoading) return <DashboardSkeleton />
  if (!data) return null

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-eyebrow">Indicadores</p>
        <div className="flex items-center gap-2">
          <span className="text-xs text-ink-mute">Mês:</span>
          <NativeSelect value={refMonth} onChange={(e) => setRefMonth(e.target.value)} className="h-8 rounded-md border px-2 text-sm capitalize">
            {monthOptions.map((m) => (
              <option key={m.value || 'atual'} value={m.value}>{m.label}</option>
            ))}
          </NativeSelect>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Contratos ativos" value={data.kpis.contratos_ativos} />
        <KpiCard label="Casos ativos" value={data.kpis.casos_ativos} hint="Exclui filhos de carteira" />
        <KpiCard label="Casos novos no mês" value={data.kpis.casos_novos_mes} />
        <KpiCard label="Contratos novos no mês" value={data.kpis.contratos_novos_mes} />
      </div>

      <StackedAreaChart serie={data.serie_temporal} />

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <AvatarBarChart title="Por responsável" items={data.por_responsavel} hint="top 6 ativos" onSelect={(nome) => setDrill({ dim: 'por_responsavel', valor: nome })} />
        <DonutChart title="Por serviço" items={data.por_servico} hint="distribuição" onSelect={(nome) => setDrill({ dim: 'por_servico', valor: nome })} />
        <DonutChart title="Por produto" items={data.por_produto} hint="distribuição" onSelect={(nome) => setDrill({ dim: 'por_produto', valor: nome })} />
        <CentroCustoCard items={data.por_centro_custo} totalCasos={data.kpis.casos_ativos} onSelect={(nome) => setDrill({ dim: 'por_centro_custo', valor: nome })} />
        <RegraCard items={data.por_regra_cobranca_mes} onSelect={(nome) => setDrill({ dim: 'por_regra_cobranca_mes', valor: nome })} />
        <PodiumList title="Top 10 clientes (por contratos)" items={data.por_cliente_top} hint="ranking" onSelect={(nome) => setDrill({ dim: 'por_cliente_top', valor: nome })} />
        <StatusStackedBar items={data.por_status} hint="proporção" onSelect={(nome) => setDrill({ dim: 'por_status', valor: nome })} />
      </div>

      <Dialog open={!!drill} onOpenChange={(open) => { if (!open) setDrill(null) }}>
        <DialogContent className="max-h-[80vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {drill ? `${DRILL_TITULOS[drill.dim] || ''}: ${drill.valor}` : ''}
            </DialogTitle>
          </DialogHeader>
          {drillLoading ? (
            <p className="text-sm text-ink-mute">Carregando…</p>
          ) : !drillRows || drillRows.length === 0 ? (
            <p className="text-sm text-ink-mute">Nenhum contrato encontrado.</p>
          ) : (
            <div className="space-y-1">
              <p className="text-xs text-ink-mute">{drillRows.length} registro(s)</p>
              <ul className="divide-y divide-hairline">
                {drillRows.map((row, i) => (
                  <li key={`${row.numero}-${i}`} className="py-2 text-sm">
                    <span className="font-medium text-ink">{row.numero ? `Contrato ${row.numero}` : row.nome}</span>
                    <span className="text-ink-mute"> · {row.cliente}</span>
                    {row.caso ? <p className="text-xs text-ink-mute">{row.caso}</p> : null}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
