'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { NativeSelect } from '@/components/ui/native-select'

interface KPI { count: number; valor: number }
interface Grupo { label: string; count: number; valor: number }
interface ClienteOpt { id: string; nome: string }
interface DashboardData {
  hoje: KPI
  semana: KPI
  mes: KPI
  filtro_total: KPI
  por_cliente: Grupo[]
  por_caso: Grupo[]
  clientes: ClienteOpt[]
}

function formatMoney(v: number | null | undefined) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v || 0))
}

function KpiCard({ label, kpi }: { label: string; kpi: KPI }) {
  return (
    <div className="rounded-lg border border-hairline bg-white p-4">
      <p className="text-eyebrow">{label}</p>
      <p className="mt-1 text-2xl font-light text-ink">{formatMoney(kpi?.valor)}</p>
      <p className="mt-1 text-xs text-ink-mute">{kpi?.count ?? 0} lançamento(s)</p>
    </div>
  )
}

function Breakdown({ titulo, grupos }: { titulo: string; grupos: Grupo[] }) {
  const max = Math.max(1, ...grupos.map((g) => g.valor))
  return (
    <div className="rounded-lg border border-hairline bg-white p-4">
      <p className="text-eyebrow mb-3">{titulo}</p>
      {grupos.length === 0 ? (
        <p className="text-sm text-ink-mute">Sem lançamentos no período</p>
      ) : (
        <ul className="space-y-2">
          {grupos.map((g) => (
            <li key={g.label} className="text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-ink-secondary">{g.label}</span>
                <span className="shrink-0 font-tabular text-ink">{formatMoney(g.valor)} <span className="text-ink-mute">· {g.count}</span></span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-secondary">
                <div className="h-1.5 rounded-full bg-primary" style={{ width: `${(g.valor / max) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function DespesasDashboard() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refMonth, setRefMonth] = useState('')
  const [clienteId, setClienteId] = useState('')

  const monthOptions = useMemo(() => {
    const opts: Array<{ value: string; label: string }> = [{ value: '', label: 'Mês atual' }]
    const now = new Date()
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      opts.push({ value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }) })
    }
    return opts
  }, [])

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true)
        const supabase = createClient()
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) return
        const params = new URLSearchParams()
        if (refMonth) params.set('ref_month', refMonth)
        if (clienteId) params.set('cliente_id', clienteId)
        const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-despesas-dashboard?${params.toString()}`, {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            ...(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY } : {}),
            'Content-Type': 'application/json',
          },
        })
        const payload = await response.json().catch(() => ({}))
        if (response.ok) setData(payload.data as DashboardData)
      } catch (err) {
        console.error(err)
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [refMonth, clienteId])

  if (loading && !data) {
    return (
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[1, 2, 3, 4].map((i) => <div key={i} className="h-24 animate-pulse rounded-lg bg-secondary" />)}
      </div>
    )
  }
  if (!data) return null

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <span className="text-xs text-ink-mute">Filtros:</span>
        <NativeSelect value={refMonth} onChange={(e) => setRefMonth(e.target.value)} className="h-8 rounded-md border px-2 text-sm capitalize">
          {monthOptions.map((m) => <option key={m.value || 'atual'} value={m.value}>{m.label}</option>)}
        </NativeSelect>
        <NativeSelect value={clienteId} onChange={(e) => setClienteId(e.target.value)} className="h-8 max-w-[220px] rounded-md border px-2 text-sm">
          <option value="">Todos os clientes</option>
          {(data.clientes || []).map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </NativeSelect>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Hoje" kpi={data.hoje} />
        <KpiCard label="Esta semana" kpi={data.semana} />
        <KpiCard label="Este mês" kpi={data.mes} />
        <KpiCard label="Total no período (filtro)" kpi={data.filtro_total} />
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Breakdown titulo="Por cliente (período)" grupos={data.por_cliente} />
        <Breakdown titulo="Por caso (período)" grupos={data.por_caso} />
      </div>
    </div>
  )
}
