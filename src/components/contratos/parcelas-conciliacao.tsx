'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

interface Parcela {
  index: number
  valor: number | null
  data_pagamento: string | null
  faturada: boolean
  faturada_at: string | null
  nf_ref: string | null
  paga: boolean
  paga_at: string | null
}

const brl = (n: number | null) => (n == null ? '—' : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }))
const fmtDate = (d: string | null) => (d ? new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR') : '—')

export default function ParcelasConciliacao({ casoId, canWrite }: { casoId: string; canWrite: boolean }) {
  const [parcelas, setParcelas] = useState<Parcela[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<number | null>(null)

  const load = useCallback(async () => {
    try {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return
      const { data, error } = await supabase.rpc('get_caso_parcelas', { p_user_id: session.user.id, p_caso_id: casoId })
      if (!error && data) setParcelas(data as Parcela[])
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [casoId])

  useEffect(() => { void load() }, [load])

  const toggle = async (p: Parcela, field: 'faturada' | 'paga', value: boolean) => {
    if (!canWrite) return
    try {
      setSaving(p.index)
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return
      await supabase.rpc('set_parcela_conciliacao', {
        p_user_id: session.user.id,
        p_caso_id: casoId,
        p_parcela_index: p.index,
        p_faturada: field === 'faturada' ? value : p.faturada,
        p_paga: field === 'paga' ? value : p.paga,
        p_nf_ref: p.nf_ref,
      })
      await load()
    } catch (e) {
      console.error(e)
    } finally {
      setSaving(null)
    }
  }

  if (loading || parcelas.length === 0) return null

  const faturadas = parcelas.filter((p) => p.faturada).length
  const pagas = parcelas.filter((p) => p.paga).length

  return (
    <div className="space-y-3 md:col-span-2">
      <div className="border-t" />
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-base font-semibold">Conciliação financeira das parcelas</p>
        <p className="text-xs text-ink-mute">{faturadas}/{parcelas.length} faturadas · {pagas}/{parcelas.length} pagas</p>
      </div>
      <p className="text-sm text-muted-foreground">Marque cada parcela como faturada (NF emitida) e paga (crédito baixado).</p>
      <div className="overflow-hidden rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-canvas-soft text-xs uppercase text-ink-mute">
            <tr>
              <th className="px-3 py-2 text-left">Parcela</th>
              <th className="px-3 py-2 text-left">Vencimento</th>
              <th className="px-3 py-2 text-right">Valor</th>
              <th className="px-3 py-2 text-center">Faturada</th>
              <th className="px-3 py-2 text-center">Paga</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {parcelas.map((p) => (
              <tr key={p.index}>
                <td className="px-3 py-2 font-medium text-ink">{p.index + 1}ª</td>
                <td className="px-3 py-2 text-ink-secondary">{fmtDate(p.data_pagamento)}</td>
                <td className="px-3 py-2 text-right font-tabular text-ink">{brl(p.valor)}</td>
                <td className="px-3 py-2 text-center">
                  <label className="inline-flex items-center gap-1">
                    <input type="checkbox" checked={p.faturada} disabled={!canWrite || saving === p.index} onChange={(e) => void toggle(p, 'faturada', e.target.checked)} />
                    {p.faturada && p.faturada_at ? <span className="text-[10px] text-emerald-700">{fmtDate(p.faturada_at)}</span> : null}
                  </label>
                </td>
                <td className="px-3 py-2 text-center">
                  <label className="inline-flex items-center gap-1">
                    <input type="checkbox" checked={p.paga} disabled={!canWrite || saving === p.index} onChange={(e) => void toggle(p, 'paga', e.target.checked)} />
                    {p.paga && p.paga_at ? <span className="text-[10px] text-emerald-700">{fmtDate(p.paga_at)}</span> : null}
                  </label>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
