'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

interface Grupo {
  label: string
  count: number
}

interface DashboardData {
  total: number
  por_categoria: Grupo[]
  por_cargo: Grupo[]
  por_centro_custo: Grupo[]
  por_adicional: Grupo[]
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

function Breakdown({ titulo, grupos, labelMap }: { titulo: string; grupos: Grupo[]; labelMap?: Record<string, string> }) {
  return (
    <div className="rounded-lg border border-hairline bg-white p-4">
      <p className="text-eyebrow mb-3">{titulo}</p>
      {grupos.length === 0 ? (
        <p className="text-sm text-ink-mute">—</p>
      ) : (
        <ul className="space-y-1.5">
          {grupos.map((g) => (
            <li key={g.label} className="flex items-center justify-between text-sm">
              <span className="truncate text-ink-secondary">{labelMap?.[g.label] || g.label}</span>
              <span className="font-tabular font-medium text-ink">{g.count}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
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
          <div key={i} className="h-28 animate-pulse rounded-lg bg-gray-100" />
        ))}
      </div>
    )
  }

  if (!data) return null

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-lg border border-hairline bg-white p-4">
          <p className="text-eyebrow">Total de colaboradores</p>
          <p className="mt-1 text-3xl font-light text-ink">{data.total}</p>
          <p className="mt-1 text-xs text-ink-mute">ativos</p>
        </div>
        <Breakdown titulo="Por categoria" grupos={data.por_categoria} labelMap={CATEGORIA_LABEL} />
        <Breakdown titulo="Função adicional" grupos={data.por_adicional} labelMap={ADICIONAL_LABEL} />
        <Breakdown titulo="Por centro de custo" grupos={data.por_centro_custo} />
      </div>
      <Breakdown titulo="Por cargo" grupos={data.por_cargo} />
    </div>
  )
}
