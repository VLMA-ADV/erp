'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { NativeSelect } from '@/components/ui/native-select'

interface Linha {
  label: string
  horas: number
  horas_aprovadas: number
  valor_projetado: number
  valor_aprovado: number
}
interface KPI { horas: number; horas_aprovadas: number; valor_projetado: number; valor_aprovado: number }
interface ClienteOpt { id: string; nome: string }
interface GestaoData {
  is_gestor: boolean
  area_nome?: string
  equipe_count?: number
  minhas?: KPI
  equipe_total?: KPI
  por_pessoa?: Linha[]
  por_cliente?: Linha[]
  por_caso?: Linha[]
  clientes?: ClienteOpt[]
}

const money = (v: number | null | undefined) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v || 0))
const horas = (v: number | null | undefined) => `${Number(v || 0).toFixed(1)}h`

function Tabela({ titulo, linhas }: { titulo: string; linhas: Linha[] }) {
  return (
    <div className="rounded-lg border border-hairline bg-white p-4">
      <p className="text-eyebrow mb-3">{titulo}</p>
      {linhas.length === 0 ? (
        <p className="text-sm text-ink-mute">Sem horas no período</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-ink-mute">
              <th className="pb-1 font-medium"> </th>
              <th className="pb-1 text-right font-medium">Lançadas</th>
              <th className="pb-1 text-right font-medium">Aprovadas</th>
              <th className="pb-1 text-right font-medium">Proj. (R$)</th>
              <th className="pb-1 text-right font-medium">Aprov. (R$)</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.label} className="border-t border-hairline">
                {/* w-full + max-w-0 força o truncate dentro da célula (senão o nome longo estica a tabela e vaza do card) */}
                <td className="w-full max-w-0 truncate py-1.5 pr-2 text-ink-secondary" title={l.label}>{l.label}</td>
                <td className="whitespace-nowrap py-1.5 text-right font-tabular">{horas(l.horas)}</td>
                <td className="whitespace-nowrap py-1.5 text-right font-tabular">{horas(l.horas_aprovadas)}</td>
                <td className="whitespace-nowrap py-1.5 pl-2 text-right font-tabular text-ink">{money(l.valor_projetado)}</td>
                <td className="whitespace-nowrap py-1.5 pl-2 text-right font-tabular text-emerald-700">{money(l.valor_aprovado)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

export default function GestaoHorasDashboard() {
  const [data, setData] = useState<GestaoData | null>(null)
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
        const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-gestao-horas?${params.toString()}`, {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            ...(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY } : {}),
            'Content-Type': 'application/json',
          },
        })
        const payload = await response.json().catch(() => ({}))
        if (response.ok) setData(payload.data as GestaoData)
      } catch (err) {
        console.error(err)
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [refMonth, clienteId])

  if (loading && !data) return null
  if (!data || !data.is_gestor) return (
    <p className="rounded-xl border border-dashed border-hairline bg-canvas-soft p-6 text-center text-sm text-ink-mute">
      A gestão de horas da equipe fica disponível para sócios e coordenadores de centro de custo.
    </p>
  )

  return (
    <section className="mb-6 space-y-3 rounded-xl border bg-canvas-soft p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-eyebrow">Gestão de horas</p>
          <p className="text-sm text-ink-mute">Centro de custo: <span className="font-medium text-ink">{data.area_nome}</span> · {data.equipe_count} pessoa(s)</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <NativeSelect value={refMonth} onChange={(e) => setRefMonth(e.target.value)} className="h-8 rounded-md border px-2 text-sm capitalize">
            {monthOptions.map((m) => <option key={m.value || 'atual'} value={m.value}>{m.label}</option>)}
          </NativeSelect>
          <NativeSelect value={clienteId} onChange={(e) => setClienteId(e.target.value)} className="h-8 max-w-[200px] rounded-md border px-2 text-sm">
            <option value="">Todos os clientes</option>
            {(data.clientes || []).map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </NativeSelect>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-lg border border-hairline bg-white p-4">
          <p className="text-eyebrow">Minhas horas</p>
          <p className="mt-1 text-2xl font-light text-ink">{horas(data.minhas?.horas)}</p>
          <p className="mt-1 text-xs text-ink-mute">aprovadas: {horas(data.minhas?.horas_aprovadas)}</p>
        </div>
        <div className="rounded-lg border border-hairline bg-white p-4">
          <p className="text-eyebrow">Horas da equipe</p>
          <p className="mt-1 text-2xl font-light text-ink">{horas(data.equipe_total?.horas)}</p>
          <p className="mt-1 text-xs text-ink-mute">aprovadas: {horas(data.equipe_total?.horas_aprovadas)}</p>
        </div>
        <div className="rounded-lg border border-hairline bg-white p-4">
          <p className="text-eyebrow">Projeção (lançadas)</p>
          <p className="mt-1 text-2xl font-light text-ink">{money(data.equipe_total?.valor_projetado)}</p>
          <p className="mt-1 text-xs text-ink-mute">horas × valor/hora do caso</p>
        </div>
        <div className="rounded-lg border border-hairline bg-white p-4">
          <p className="text-eyebrow">Projeção (aprovadas)</p>
          <p className="mt-1 text-2xl font-light text-emerald-700">{money(data.equipe_total?.valor_aprovado)}</p>
          <p className="mt-1 text-xs text-ink-mute">horas aprovadas × valor/hora</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Tabela titulo="Por pessoa" linhas={data.por_pessoa || []} />
        <Tabela titulo="Por cliente" linhas={data.por_cliente || []} />
        <Tabela titulo="Por caso" linhas={data.por_caso || []} />
      </div>
    </section>
  )
}
