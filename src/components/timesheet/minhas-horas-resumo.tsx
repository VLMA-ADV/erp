'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

interface Linha { label: string; horas: number }
interface Resumo {
  hoje: number
  semana: number
  mes: number
  mes_aprovadas: number
  por_cliente: Linha[]
  por_caso: Linha[]
}

const fmtH = (n: number) => `${(n ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 1 })}h`

function MiniTabela({ titulo, linhas }: { titulo: string; linhas: Linha[] }) {
  const top = linhas.slice(0, 6)
  return (
    <div className="rounded-xl border border-hairline bg-card p-4">
      <p className="text-eyebrow mb-2">{titulo}</p>
      {top.length === 0 ? (
        <p className="text-sm text-ink-mute">—</p>
      ) : (
        <ul className="space-y-1">
          {top.map((l) => (
            <li key={l.label} className="flex items-center gap-2 text-xs">
              <span className="min-w-0 flex-1 truncate text-ink-secondary" title={l.label}>{l.label}</span>
              <span className="shrink-0 font-tabular font-medium text-ink">{fmtH(l.horas)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function MinhasHorasResumo() {
  const [data, setData] = useState<Resumo | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      try {
        const supabase = createClient()
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) return
        const { data: res, error } = await supabase.rpc('get_minhas_horas_resumo', { p_user_id: session.user.id })
        if (!error && res) setData(res as Resumo)
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
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[1, 2, 3, 4].map((i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-secondary" />)}
      </div>
    )
  }
  if (!data) return null

  const kpis = [
    { label: 'Hoje', value: fmtH(data.hoje) },
    { label: 'Esta semana', value: fmtH(data.semana) },
    { label: 'Este mês', value: fmtH(data.mes) },
    { label: 'Aprovadas (mês)', value: fmtH(data.mes_aprovadas), accent: true },
  ]

  return (
    <div className="mb-6 space-y-3">
      <p className="text-eyebrow">Minhas horas</p>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {kpis.map((c) => (
          <div key={c.label} className="rounded-xl border border-hairline bg-card p-4">
            <p className="text-eyebrow">{c.label}</p>
            <p className={`mt-1 font-tabular text-2xl font-light ${c.accent ? 'text-emerald-700' : 'text-ink'}`}>{c.value}</p>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <MiniTabela titulo="Por cliente (mês)" linhas={data.por_cliente} />
        <MiniTabela titulo="Por caso (mês)" linhas={data.por_caso} />
      </div>
    </div>
  )
}
