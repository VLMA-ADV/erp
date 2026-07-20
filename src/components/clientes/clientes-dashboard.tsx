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

// "Cliente novo no ano" (resposta 3 do Filipe): ano do 1º contrato do cliente,
// com override manual (ano_captacao_override no cadastro).
function ClientesNovosCard() {
  const [ano, setAno] = useState(() => new Date().getFullYear())
  const [res, setRes] = useState<{
    total: number
    clientes: Array<{ id: string; nome: string; ajustado: boolean }>
    por_ano: Array<{ ano: number; total: number }>
  } | null>(null)
  const [aberto, setAberto] = useState(false)

  useEffect(() => {
    const load = async () => {
      try {
        const supabase = createClient()
        const { data: r, error } = await supabase.rpc('get_clientes_novos_ano', { p_ano: ano })
        if (!error && r) setRes(r as typeof res)
      } catch (err) {
        console.error(err)
      }
    }
    void load()
  }, [ano])

  const anos = (res?.por_ano || []).map((x) => x.ano)
  const anoAtual = new Date().getFullYear()
  const opcoes = Array.from(new Set([anoAtual, anoAtual - 1, anoAtual - 2, ...anos])).sort((a, b) => b - a)

  return (
    <div className="rounded-xl border border-hairline bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-eyebrow">Clientes novos no ano</p>
          <p className="mt-1 font-tabular text-3xl font-light text-ink">{res?.total ?? '—'}</p>
          <p className="mt-1 text-xs text-ink-mute">pelo 1º contrato (ajuste manual no cadastro do cliente)</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="h-8 rounded-full border px-3 text-sm"
            value={ano}
            onChange={(e) => setAno(Number(e.target.value))}
          >
            {opcoes.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <button
            type="button"
            className="rounded-full border px-3 py-1 text-xs text-ink-secondary hover:bg-canvas-soft"
            onClick={() => setAberto((v) => !v)}
            disabled={!res || res.total === 0}
          >
            {aberto ? 'Ocultar lista' : 'Ver lista'}
          </button>
        </div>
      </div>
      {aberto && res ? (
        <ul className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 border-t border-hairline pt-3 md:grid-cols-2 xl:grid-cols-3">
          {res.clientes.map((c) => (
            <li key={c.id} className="truncate text-xs text-ink-secondary" title={c.nome}>
              {c.nome}{c.ajustado ? <span className="ml-1 text-[10px] text-amber-600">(ajustado)</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
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
      <ClientesNovosCard />
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
