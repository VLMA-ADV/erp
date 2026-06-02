'use client'

import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { usePermissionsContext } from '@/lib/contexts/permissions-context'

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
  por_cliente_top: DashboardListItem[]
  por_status: DashboardListItem[]
}

const MES_PT: Record<string, string> = {
  Jan: 'Jan', Feb: 'Fev', Mar: 'Mar', Apr: 'Abr', May: 'Mai', Jun: 'Jun',
  Jul: 'Jul', Aug: 'Ago', Sep: 'Set', Oct: 'Out', Nov: 'Nov', Dec: 'Dez',
}

function rotuloPtBr(rotulo: string): string {
  const [mes, ano] = rotulo.split('/')
  return `${MES_PT[mes] || mes}/${ano}`
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

function MiniBarChart({ title, items, colorClass = 'bg-primary' }: { title: string; items: DashboardListItem[]; colorClass?: string }) {
  const topItems = items.slice(0, 6)
  const max = topItems.reduce((acc, item) => Math.max(acc, item.total), 0)

  return (
    <div className="flex h-full min-h-[180px] flex-col rounded-xl border bg-white p-3 shadow-sm">
      <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.18em] text-ink-mute">{title}</p>
      <div className="flex-1 space-y-1.5">
        {topItems.length === 0 ? (
          <p className="text-xs text-ink-mute">Sem dados</p>
        ) : (
          topItems.map((item) => {
            const width = max > 0 ? (item.total / max) * 100 : 0
            return (
              <div key={`${title}-${item.nome}`} className="space-y-1">
                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="truncate text-ink-mute" title={item.nome}>{item.nome}</span>
                  <span className="font-medium text-ink font-tabular">{item.total}</span>
                </div>
                <div className="h-1.5 rounded-full bg-canvas-soft">
                  <div className={`h-1.5 rounded-full ${colorClass}`} style={{ width: `${width}%` }} />
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

function LineChart({ serie }: { serie: SerieTemporalItem[] }) {
  const width = 800
  const height = 180
  const padding = { top: 16, right: 12, bottom: 28, left: 32 }
  const innerW = width - padding.left - padding.right
  const innerH = height - padding.top - padding.bottom

  const maxContratos = Math.max(1, ...serie.map((s) => s.contratos_novos))
  const maxCasos = Math.max(1, ...serie.map((s) => s.casos_novos))
  const max = Math.max(maxContratos, maxCasos)
  const yTicks = [0, Math.ceil(max / 2), max]

  const xStep = serie.length > 1 ? innerW / (serie.length - 1) : 0
  const xCoord = (i: number) => padding.left + i * xStep
  const yCoord = (v: number) => padding.top + innerH - (v / max) * innerH

  const pathContratos = serie.map((s, i) => `${i === 0 ? 'M' : 'L'} ${xCoord(i)} ${yCoord(s.contratos_novos)}`).join(' ')
  const pathCasos = serie.map((s, i) => `${i === 0 ? 'M' : 'L'} ${xCoord(i)} ${yCoord(s.casos_novos)}`).join(' ')

  const areaContratos = `${pathContratos} L ${xCoord(serie.length - 1)} ${padding.top + innerH} L ${padding.left} ${padding.top + innerH} Z`

  return (
    <div className="flex h-full flex-col rounded-xl border bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-ink-mute">Tempo x volume</p>
          <p className="text-sm text-ink">Contratos e casos novos por mês (últimos 12 meses)</p>
        </div>
        <div className="flex gap-3 text-[11px]">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-primary" />
            <span className="text-ink-mute">Contratos</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-amber-500" />
            <span className="text-ink-mute">Casos</span>
          </span>
        </div>
      </div>
      <div className="relative w-full overflow-hidden">
        <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" preserveAspectRatio="none">
          {yTicks.map((t) => (
            <g key={`grid-${t}`}>
              <line x1={padding.left} x2={width - padding.right} y1={yCoord(t)} y2={yCoord(t)} stroke="currentColor" className="text-canvas-soft" strokeWidth={1} />
              <text x={padding.left - 6} y={yCoord(t) + 3} textAnchor="end" className="fill-ink-mute text-[10px] font-tabular">{t}</text>
            </g>
          ))}
          <path d={areaContratos} className="fill-primary" opacity={0.08} />
          <path d={pathContratos} fill="none" className="stroke-primary" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          <path d={pathCasos} fill="none" stroke="#f59e0b" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          {serie.map((s, i) => (
            <g key={`pts-${s.mes}`}>
              <circle cx={xCoord(i)} cy={yCoord(s.contratos_novos)} r={3} className="fill-primary" />
              <circle cx={xCoord(i)} cy={yCoord(s.casos_novos)} r={3} fill="#f59e0b" />
              <text x={xCoord(i)} y={height - 8} textAnchor="middle" className="fill-ink-mute text-[10px]">{rotuloPtBr(s.rotulo)}</text>
            </g>
          ))}
        </svg>
      </div>
    </div>
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

export default function ContratosDashboard() {
  const { hasPermission } = usePermissionsContext()
  const canRead = hasPermission('contracts.contratos.read')

  const { data, isLoading } = useQuery({
    queryKey: ['contracts-dashboard-v2'],
    enabled: canRead,
    queryFn: async (): Promise<ContratosDashboardData | null> => {
      try {
        const supabase = createClient()
        const { data: { session } } = await supabase.auth.getSession()
        if (!session?.user?.id) return null

        const { data: tenantResult, error: tenantError } = await supabase.rpc('get_user_tenant', { p_user_id: session.user.id })
        if (tenantError) return null

        let tenantId: string | null = null
        if (Array.isArray(tenantResult) && tenantResult[0]?.tenant_id) {
          tenantId = String(tenantResult[0].tenant_id)
        } else if (tenantResult && typeof tenantResult === 'object' && 'tenant_id' in tenantResult) {
          tenantId = String((tenantResult as Record<string, unknown>).tenant_id)
        } else if (typeof tenantResult === 'string') {
          tenantId = tenantResult
        }
        if (!tenantId) return null

        const { data: raw, error } = await supabase.rpc('get_contratos_dashboard_v2', { p_tenant_id: tenantId })
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
          por_cliente_top: normalizeList(payload.por_cliente_top),
          por_status: normalizeList(payload.por_status),
        }
      } catch {
        return null
      }
    },
  })

  if (!canRead) return null
  if (isLoading) return <DashboardSkeleton />
  if (!data) return null

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Contratos ativos" value={data.kpis.contratos_ativos} />
        <KpiCard label="Casos ativos" value={data.kpis.casos_ativos} hint="Exclui filhos de carteira" />
        <KpiCard label="Casos novos no mês" value={data.kpis.casos_novos_mes} />
        <KpiCard label="Contratos novos no mês" value={data.kpis.contratos_novos_mes} />
      </div>

      <LineChart serie={data.serie_temporal} />

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <MiniBarChart title="Por responsável" items={data.por_responsavel} />
        <MiniBarChart title="Por serviço" items={data.por_servico} />
        <MiniBarChart title="Por produto" items={data.por_produto} />
        <MiniBarChart title="Por centro de custo" items={data.por_centro_custo} colorClass="bg-emerald-500" />
        <MiniBarChart title="Top 10 clientes (por contratos)" items={data.por_cliente_top} colorClass="bg-amber-500" />
        <MiniBarChart title="Por status do contrato" items={data.por_status} colorClass="bg-sky-500" />
      </div>
    </div>
  )
}
