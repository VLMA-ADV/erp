'use client'

import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { usePermissionsContext } from '@/lib/contexts/permissions-context'

interface DashboardListItem {
  nome: string
  total: number
}

interface ContratosDashboardData {
  total_contratos: number
  total_casos: number
  com_reajuste_2026: number
  por_responsavel: DashboardListItem[]
  por_servico: DashboardListItem[]
  por_produto: DashboardListItem[]
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

function MiniBarChart({ title, items }: { title: string; items: DashboardListItem[] }) {
  const topItems = items.slice(0, 4)
  const max = topItems.reduce((acc, item) => Math.max(acc, item.total), 0)

  return (
    <div className="flex h-full min-h-[132px] flex-col rounded-xl border bg-white p-3 shadow-sm">
      <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.18em] text-gray-500">{title}</p>
      <div className="space-y-1.5">
        {topItems.length === 0 ? (
          <p className="text-xs text-gray-400">Sem dados</p>
        ) : (
          topItems.map((item) => {
            const width = max > 0 ? (item.total / max) * 100 : 0
            return (
              <div key={`${title}-${item.nome}`} className="space-y-1">
                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="truncate text-gray-600">{item.nome}</span>
                  <span className="font-medium text-gray-900">{item.total}</span>
                </div>
                <div className="h-1.5 rounded-full bg-gray-100">
                  <div className="h-1.5 rounded-full bg-blue-500" style={{ width: `${width}%` }} />
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

function DashboardSkeleton() {
  return (
    <div className="rounded-2xl border bg-slate-50/80 p-3">
      <div className="grid gap-3 xl:grid-cols-[280px_minmax(0,1fr)]">
        <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
          {[1, 2, 3].map((item) => (
            <div key={item} className="rounded-xl border bg-white p-3 shadow-sm">
              <div className="animate-pulse space-y-2">
                <div className="h-3 w-20 rounded bg-gray-200" />
                <div className="h-7 w-14 rounded bg-gray-200" />
              </div>
            </div>
          ))}
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {[1, 2, 3].map((item) => (
            <div key={`chart-${item}`} className="rounded-xl border bg-white p-3 shadow-sm">
              <div className="animate-pulse space-y-2">
                <div className="h-3 w-24 rounded bg-gray-200" />
                {[1, 2, 3].map((row) => (
                  <div key={row} className="space-y-1">
                    <div className="h-2.5 w-full rounded bg-gray-100" />
                    <div className="h-1.5 w-full rounded bg-gray-200" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function ContratosDashboard() {
  const { hasPermission } = usePermissionsContext()
  const canRead = hasPermission('contracts.contratos.read')

  const { data, isLoading } = useQuery({
    queryKey: ['contracts-dashboard'],
    enabled: canRead,
    queryFn: async (): Promise<ContratosDashboardData | null> => {
      try {
        const supabase = createClient()
        const {
          data: { session },
        } = await supabase.auth.getSession()
        if (!session?.user?.id) return null

        // get_user_tenant returns TABLE(tenant_id uuid) — may come as array or single object
        const { data: tenantResult, error: tenantError } = await supabase.rpc('get_user_tenant', {
          p_user_id: session.user.id,
        })
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

        // get_contratos_dashboard — function must be in public schema for PostgREST access
        const { data: dashboardRaw, error: dashboardError } = await supabase.rpc('get_contratos_dashboard', {
          p_tenant_id: tenantId,
        })
        if (dashboardError || !dashboardRaw) return null

        const payload: Record<string, unknown> =
          typeof dashboardRaw === 'string' ? JSON.parse(dashboardRaw) : dashboardRaw
        if (!payload || typeof payload !== 'object') return null

        return {
          total_contratos: Number(payload.total_contratos || 0),
          total_casos: Number(payload.total_casos || 0),
          com_reajuste_2026: Number(payload.com_reajuste_2026 || 0),
          por_responsavel: normalizeList(payload.por_responsavel),
          por_servico: normalizeList(payload.por_servico),
          por_produto: normalizeList(payload.por_produto),
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
    <div className="overflow-hidden rounded-2xl border bg-slate-50/80 p-3">
      <div className="grid gap-3 xl:max-h-[200px] xl:grid-cols-[280px_minmax(0,1fr)]">
        <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
          <div className="rounded-xl border bg-white p-3 shadow-sm">
            <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Contratos</p>
            <p className="mt-1 text-2xl font-semibold leading-none text-gray-900">{data.total_contratos}</p>
          </div>
          <div className="rounded-xl border bg-white p-3 shadow-sm">
            <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Casos</p>
            <p className="mt-1 text-2xl font-semibold leading-none text-gray-900">{data.total_casos}</p>
          </div>
          <div className="rounded-xl border bg-white p-3 shadow-sm">
            <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Reajuste 2026</p>
            <p className="mt-1 text-2xl font-semibold leading-none text-gray-900">{data.com_reajuste_2026}</p>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
        <MiniBarChart title="Por responsável" items={data.por_responsavel} />
        <MiniBarChart title="Por serviço" items={data.por_servico} />
        <MiniBarChart title="Por produto" items={data.por_produto} />
        </div>
      </div>
    </div>
  )
}
