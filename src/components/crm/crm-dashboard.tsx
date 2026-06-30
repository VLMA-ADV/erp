'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

interface Grupo {
  label: string
  count: number
  valor: number
}
interface Localidade {
  uf: string
  count: number
  valor: number
}
interface DashboardData {
  total: number
  valor_total: number
  por_fase: Grupo[]
  por_centro_custo: Grupo[]
  por_produto: Grupo[]
  por_responsavel: Grupo[]
  por_temperatura: Grupo[]
  por_segmento: Grupo[]
  por_localidade: Localidade[]
}

const FASE_LABEL: Record<string, string> = {
  prospeccao: 'Prospecção',
  proposta_solicitada: 'Proposta solicitada',
  proposta_enviada: 'Proposta enviada',
  conversao: 'Conversão',
  negada: 'Negada',
  suspensa: 'Suspensa',
}

// Tile-grid aproximado do Brasil (coluna, linha) — norte no topo, sul embaixo.
const UF_POS: Record<string, [number, number]> = {
  RR: [3, 0], AP: [4, 0],
  AM: [2, 1], PA: [3, 1], MA: [4, 1], CE: [5, 1], RN: [6, 1],
  AC: [1, 2], RO: [2, 2], TO: [3, 2], PI: [4, 2], PE: [5, 2], PB: [6, 2],
  MT: [2, 3], DF: [3, 3], BA: [4, 3], SE: [5, 3], AL: [6, 3],
  MS: [2, 4], GO: [3, 4], MG: [4, 4], ES: [5, 4],
  PR: [2, 5], SP: [3, 5], RJ: [4, 5],
  SC: [2, 6],
  RS: [2, 7],
}

function formatMoney(value: number | null | undefined) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(Number(value || 0))
}

function Breakdown({ titulo, grupos, labelMap }: { titulo: string; grupos: Grupo[]; labelMap?: Record<string, string> }) {
  const max = Math.max(1, ...grupos.map((g) => g.count))
  return (
    <div className="rounded-lg border border-hairline bg-white p-4">
      <p className="text-eyebrow mb-3">{titulo}</p>
      {grupos.length === 0 ? (
        <p className="text-sm text-ink-mute">—</p>
      ) : (
        <ul className="space-y-2">
          {grupos.slice(0, 8).map((g) => (
            <li key={g.label} className="text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-ink-secondary">{labelMap?.[g.label] || g.label}</span>
                <span className="shrink-0 font-tabular text-ink">
                  {g.count} <span className="text-ink-mute">· {formatMoney(g.valor)}</span>
                </span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-secondary">
                <div className="h-1.5 rounded-full bg-primary" style={{ width: `${(g.count / max) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function MapaBrasil({ localidades }: { localidades: Localidade[] }) {
  const byUf = new Map(localidades.filter((l) => l.uf && l.uf !== '??').map((l) => [l.uf, l]))
  const semUf = localidades.find((l) => l.uf === '??')
  const max = Math.max(1, ...Array.from(byUf.values()).map((l) => l.count))

  return (
    <div className="rounded-lg border border-hairline bg-white p-4">
      <p className="text-eyebrow mb-3">Localidades (por UF)</p>
      <div className="grid w-fit gap-1" style={{ gridTemplateColumns: 'repeat(7, 26px)', gridAutoRows: '26px' }}>
        {Object.entries(UF_POS).map(([uf, [col, row]]) => {
          const item = byUf.get(uf)
          const intensity = item ? 0.2 + 0.8 * (item.count / max) : 0
          return (
            <div
              key={uf}
              title={item ? `${uf}: ${item.count} oportunidade(s) · ${formatMoney(item.valor)}` : `${uf}: 0`}
              className="flex items-center justify-center rounded text-[9px] font-medium"
              style={{
                gridColumnStart: col,
                gridRowStart: row + 1,
                backgroundColor: item ? `rgba(79,70,229,${intensity})` : '#f3f4f6',
                color: item && intensity > 0.55 ? '#fff' : '#6b7280',
              }}
            >
              {uf}
            </div>
          )
        })}
      </div>
      {semUf ? (
        <p className="mt-3 text-xs text-ink-mute">Sem UF informada: {semUf.count} oportunidade(s)</p>
      ) : null}
    </div>
  )
}

export default function CrmDashboard() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      try {
        const supabase = createClient()
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) return
        const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-crm-dashboard`, {
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
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-lg border border-hairline bg-white p-4">
          <p className="text-eyebrow">Oportunidades</p>
          <p className="mt-1 text-3xl font-light text-ink">{data.total}</p>
          <p className="mt-1 text-xs text-ink-mute">no funil (ativas)</p>
        </div>
        <div className="rounded-lg border border-hairline bg-white p-4">
          <p className="text-eyebrow">Valor total</p>
          <p className="mt-1 text-2xl font-light text-ink">{formatMoney(data.valor_total)}</p>
          <p className="mt-1 text-xs text-ink-mute">soma das oportunidades</p>
        </div>
        <Breakdown titulo="Por temperatura" grupos={data.por_temperatura} />
        <Breakdown titulo="Por centro de custo" grupos={data.por_centro_custo} />
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Breakdown titulo="Valor por fase" grupos={data.por_fase} labelMap={FASE_LABEL} />
        <Breakdown titulo="Por produto" grupos={data.por_produto} />
        <Breakdown titulo="Por responsável" grupos={data.por_responsavel} />
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Breakdown titulo="Por segmento econômico" grupos={data.por_segmento} />
        <div className="md:col-span-2">
          <MapaBrasil localidades={data.por_localidade} />
        </div>
      </div>
    </div>
  )
}
