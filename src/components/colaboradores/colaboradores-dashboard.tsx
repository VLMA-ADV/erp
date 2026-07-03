'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { DonutBreakdown, type DonutGroup as Grupo } from '@/components/ui/donut-breakdown'

interface DashboardData {
  total: number
  por_categoria: Grupo[]
  por_cargo: Grupo[]
  por_centro_custo: Grupo[]
  por_adicional: Grupo[]
  por_salario: Grupo[]
}

const CATEGORIA_LABEL: Record<string, string> = {
  socio: 'Sócio',
  advogado: 'Advogado',
  administrativo: 'Administrativo',
  estagiario: 'Estagiário',
}

const ADICIONAL_LABEL: Record<string, string> = {
  lideranca: 'Liderança',
  estrategico: 'Estratégico',
  Nenhuma: 'Nenhuma',
}

export default function ColaboradoresDashboard() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      try {
        const supabase = createClient()
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) return
        const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-colaboradores-dashboard`, {
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
  }, [])

  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-28 animate-pulse rounded-lg bg-secondary" />
        ))}
      </div>
    )
  }

  if (!data) return null

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-hairline bg-brand-purple-soft p-4">
        <p className="text-eyebrow">Total de colaboradores</p>
        <p className="mt-1 font-tabular text-4xl font-light text-ink">{data.total}</p>
        <p className="mt-1 text-xs text-ink-mute">ativos</p>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        <DonutBreakdown titulo="Por categoria" grupos={data.por_categoria} labelMap={CATEGORIA_LABEL} />
        <DonutBreakdown titulo="Por cargo" grupos={data.por_cargo} />
        <DonutBreakdown titulo="Por centro de custo" grupos={data.por_centro_custo} />
        <DonutBreakdown titulo="Função adicional" grupos={data.por_adicional} labelMap={ADICIONAL_LABEL} />
        <DonutBreakdown titulo="Por faixa salarial" grupos={data.por_salario} />
      </div>
    </div>
  )
}
