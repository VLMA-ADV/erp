'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

const ANO = 2026

interface Item {
  id: string
  status: string
  faixa_final_geral: string | null
  resultado: string | null
  autoavaliacao_enviada_at: string | null
  avaliacao_gestor_enviada_at: string | null
  progressao_aplicada_at: string | null
  cargo_nome_snapshot: string | null
  area_nome_snapshot: string | null
  carreira_codigo: string | null
  adicional_snapshot: string | null
  colaborador_nome: string
  categoria: string
}

const STATUS_META: Record<string, { label: string; cls: string }> = {
  rascunho: { label: 'Rascunho', cls: 'bg-secondary text-ink-secondary' },
  autoavaliacao_enviada: { label: 'Autoavaliação enviada', cls: 'bg-amber-50 text-amber-700' },
  em_avaliacao_gestor: { label: 'Em avaliação', cls: 'bg-brand-purple-soft text-brand-purple-fg' },
  avaliacao_concluida: { label: 'Concluída', cls: 'bg-blue-50 text-blue-700' },
  progressao_aplicada: { label: 'Progressão aplicada', cls: 'bg-emerald-50 text-emerald-700' },
}

const RESULTADO_LABEL: Record<string, string> = {
  mantem_faixa_atual: 'Mantém faixa',
  progressao_simples: 'Progressão simples',
  progressao_diferenciada: 'Progressão diferenciada',
}

export default function EquipePdiPage() {
  const [itens, setItens] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')

  const load = useCallback(async () => {
    try {
      setLoading(true); setError(null)
      const supabase = createClient()
      const { data, error: err } = await supabase.rpc('get_equipe_avaliacoes_pdi', { p_ano: ANO })
      if (err) { setError(err.message); return }
      setItens(((data as { itens: Item[] })?.itens) || [])
    } catch (e) { setError((e as Error).message) } finally { setLoading(false) }
  }, [])

  useEffect(() => { void load() }, [load])

  const filtrados = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return itens
    return itens.filter((i) =>
      (i.colaborador_nome || '').toLowerCase().includes(t) ||
      (i.cargo_nome_snapshot || '').toLowerCase().includes(t) ||
      (i.area_nome_snapshot || '').toLowerCase().includes(t))
  }, [itens, q])

  const pendentes = filtrados.filter((i) => i.status === 'autoavaliacao_enviada' || i.status === 'em_avaliacao_gestor')
  const outros = filtrados.filter((i) => !(i.status === 'autoavaliacao_enviada' || i.status === 'em_avaliacao_gestor'))

  const Linha = (i: Item) => {
    const st = STATUS_META[i.status] || STATUS_META.rascunho
    return (
      <Link key={i.id} href={`/avaliacoes-pdi/equipe/${i.id}`}
        className="flex items-center gap-3 border-b border-hairline px-4 py-3 last:border-b-0 hover:bg-canvas-soft">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ink">{i.colaborador_nome}</p>
          <p className="truncate text-xs text-ink-mute">
            {[i.cargo_nome_snapshot, i.area_nome_snapshot, i.adicional_snapshot ? `+${i.adicional_snapshot}` : null].filter(Boolean).join(' · ')}
          </p>
        </div>
        {i.faixa_final_geral ? <span className="hidden shrink-0 rounded-full border border-hairline bg-card px-2.5 py-1 text-[11px] text-ink-secondary sm:inline">{i.resultado ? RESULTADO_LABEL[i.resultado] : i.faixa_final_geral}</span> : null}
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium ${st.cls}`}>{st.label}</span>
        <ChevronRight className="h-4 w-4 shrink-0 text-ink-mute" />
      </Link>
    )
  }

  return (
    <div className="container mx-auto max-w-3xl px-6 py-10">
      <header className="mb-6">
        <span className="text-eyebrow">PESSOAS · PDI {ANO}</span>
        <h1 className="mt-2 display-lg text-ink">Avaliações da equipe</h1>
        <p className="mt-2 text-sm text-ink-mute">Revise as autoavaliações, atribua a faixa final e aplique a progressão.</p>
        <Link href="/avaliacoes-pdi" className="mt-3 inline-block text-sm text-primary underline underline-offset-2">← Avaliações PDI</Link>
      </header>

      {error ? <p className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}

      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nome, cargo ou área…"
        className="mb-4 h-9 w-full rounded-md border border-hairline-input bg-background px-3 text-sm text-ink outline-none focus:ring-2 focus:ring-ring" />

      {loading ? <p className="text-sm text-ink-mute">Carregando…</p> : (
        filtrados.length === 0 ? <p className="rounded-xl border border-dashed border-hairline bg-canvas-soft p-6 text-center text-sm text-ink-mute">Nenhuma avaliação neste ciclo ainda.</p> : (
          <div className="space-y-6">
            {pendentes.length > 0 ? (
              <section>
                <p className="text-eyebrow mb-2">Aguardando você ({pendentes.length})</p>
                <div className="overflow-hidden rounded-xl border border-hairline bg-card">{pendentes.map(Linha)}</div>
              </section>
            ) : null}
            {outros.length > 0 ? (
              <section>
                <p className="text-eyebrow mb-2">Demais ({outros.length})</p>
                <div className="overflow-hidden rounded-xl border border-hairline bg-card">{outros.map(Linha)}</div>
              </section>
            ) : null}
          </div>
        )
      )}
    </div>
  )
}
