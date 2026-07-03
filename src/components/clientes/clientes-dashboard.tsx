'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { DonutBreakdown, type DonutGroup as Grupo } from '@/components/ui/donut-breakdown'

interface DashboardData {
  total: number
  por_tipo: Grupo[]
  por_estado: Grupo[]
  por_segmento: Grupo[]
  por_grupo: Grupo[]
  por_potencial: Grupo[]
}

export default function ClientesDashboard() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      try {
        const supabase = createClient()
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) return
        // Chamada direta à RPC (projeto atingiu o limite de edge functions).
        // A RPC resolve o tenant por auth.uid(); p_user_id é só fallback.
        const { data: res, error } = await supabase.rpc('get_clientes_dashboard', { p_user_id: session.user.id })
        if (!error && res) setData(res as DashboardData)
      } catch (err) {
        console.error(err)
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [])

  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-28 animate-pulse rounded-lg bg-secondary" />
        ))}
      </div>
    )
  }

  if (!data) return null

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-hairline bg-brand-purple-soft p-4">
        <p className="text-eyebrow">Total de clientes</p>
        <p className="mt-1 font-tabular text-4xl font-light text-ink">{data.total}</p>
        <p className="mt-1 text-xs text-ink-mute">ativos</p>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        <DonutBreakdown titulo="Por tipo (PF / PJ)" grupos={data.por_tipo} />
        <DonutBreakdown titulo="Por estado (UF)" grupos={data.por_estado} />
        <DonutBreakdown titulo="Por segmento econômico" grupos={data.por_segmento} />
        <DonutBreakdown titulo="Por grupo econômico" grupos={data.por_grupo} />
        <DonutBreakdown titulo="Por potencial" grupos={data.por_potencial} />
      </div>
    </div>
  )
}
