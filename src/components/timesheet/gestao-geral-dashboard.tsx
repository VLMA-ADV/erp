'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { NativeSelect } from '@/components/ui/native-select'
import { Button } from '@/components/ui/button'

interface LinhaPessoa { user_id: string; label: string; area?: string | null; horas: number; valor_projetado: number; valor_aprovado: number }
interface LinhaArea { area_id: string | null; label: string; pessoas: number; horas: number; valor_projetado: number; valor_aprovado: number }
interface LinhaSimples { label: string; horas: number; valor_projetado: number }
interface Totais { pessoas: number; pessoas_com_lancamento: number; horas: number; horas_aprovadas: number; valor_projetado: number; valor_aprovado: number }
interface FiltroOpt { areas: { id: string; nome: string }[]; pessoas: { user_id: string; nome: string }[] }
interface GestaoGeral {
  autorizado: boolean
  periodo?: { inicio: string; fim: string }
  totais?: Totais
  por_area?: LinhaArea[]
  por_pessoa?: LinhaPessoa[]
  por_cliente?: LinhaSimples[]
  por_caso?: LinhaSimples[]
  filtros?: FiltroOpt
}

const money = (v: number | null | undefined) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v || 0))
const horas = (v: number | null | undefined) => `${Number(v || 0).toFixed(1)}h`

function refMonthValue(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
function mesLabel(ym: string) {
  const [y, m] = ym.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
}

export default function GestaoGeralDashboard() {
  const [data, setData] = useState<GestaoGeral | null>(null)
  const [loading, setLoading] = useState(true)
  const [mes, setMes] = useState(() => refMonthValue(new Date()))
  const [areaId, setAreaId] = useState('')
  const [pessoaId, setPessoaId] = useState('')

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return
      const filtros: Record<string, string> = {}
      if (areaId) filtros.area_id = areaId
      if (pessoaId) filtros.pessoa_user_id = pessoaId
      const { data: res, error } = await supabase.rpc('get_gestao_geral', {
        p_user_id: session.user.id,
        p_ref_month: `${mes}-01`,
        p_filters: filtros,
      })
      if (!error && res) setData(res as GestaoGeral)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [mes, areaId, pessoaId])

  // Atualiza ao trocar o mês (recarrega sozinho); área/pessoa também.
  useEffect(() => { void load() }, [load])

  const mesesOpcoes = useMemo(() => {
    const hoje = new Date()
    return Array.from({ length: 12 }, (_, i) => {
      const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1)
      return refMonthValue(d)
    })
  }, [])

  if (loading && !data) {
    return <div className="h-64 animate-pulse rounded-xl bg-secondary" />
  }
  if (data && !data.autorizado) {
    return (
      <div className="rounded-lg border border-hairline bg-canvas-soft p-6 text-sm text-ink-mute">
        A Gestão Geral está disponível para a diretoria e o financeiro.
      </div>
    )
  }
  const t = data?.totais

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-hairline bg-white p-4">
        <label className="flex flex-col gap-1 text-xs text-ink-mute">
          Mês
          <NativeSelect value={mes} onChange={(e) => setMes(e.target.value)} className="min-w-[160px] capitalize">
            {mesesOpcoes.map((ym) => <option key={ym} value={ym}>{mesLabel(ym)}</option>)}
          </NativeSelect>
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-mute">
          Centro de custo
          <NativeSelect value={areaId} onChange={(e) => setAreaId(e.target.value)} className="min-w-[170px]">
            <option value="">Todos</option>
            {(data?.filtros?.areas || []).map((a) => <option key={a.id} value={a.id}>{a.nome}</option>)}
          </NativeSelect>
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-mute">
          Pessoa
          <NativeSelect value={pessoaId} onChange={(e) => setPessoaId(e.target.value)} className="min-w-[190px]">
            <option value="">Todas</option>
            {(data?.filtros?.pessoas || []).map((p) => <option key={p.user_id} value={p.user_id}>{p.nome}</option>)}
          </NativeSelect>
        </label>
        <Button variant="outline" onClick={() => void load()} disabled={loading} className="ml-auto">
          {loading ? 'Atualizando…' : 'Atualizar'}
        </Button>
      </div>

      {/* KPIs do escritório */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-xl border border-hairline bg-card p-4">
          <p className="text-eyebrow">Pessoas</p>
          <p className="mt-1 text-2xl font-light text-ink">{t?.pessoas ?? 0}</p>
          <p className="mt-1 text-xs text-ink-mute">{t?.pessoas_com_lancamento ?? 0} lançaram no mês</p>
        </div>
        <div className="rounded-xl border border-hairline bg-card p-4">
          <p className="text-eyebrow">Horas lançadas</p>
          <p className="mt-1 text-2xl font-light text-ink">{horas(t?.horas)}</p>
          <p className="mt-1 text-xs text-ink-mute">aprovadas: {horas(t?.horas_aprovadas)}</p>
        </div>
        <div className="rounded-xl border border-hairline bg-card p-4">
          <p className="text-eyebrow">Valor projetado</p>
          <p className="mt-1 text-2xl font-light text-ink">{money(t?.valor_projetado)}</p>
          <p className="mt-1 text-xs text-ink-mute">estimativa, não é receita</p>
        </div>
        <div className="rounded-xl border border-hairline bg-card p-4">
          <p className="text-eyebrow">Valor aprovado</p>
          <p className="mt-1 text-2xl font-light text-emerald-700">{money(t?.valor_aprovado)}</p>
        </div>
      </div>

      {/* Por centro de custo */}
      <TabelaGeral titulo="Por centro de custo" colPrimeira="Centro de custo" linhas={(data?.por_area || []).map((a) => ({
        label: a.label, extra: `${a.pessoas} pessoa(s)`, horas: a.horas, vp: a.valor_projetado, va: a.valor_aprovado,
      }))} />

      {/* Por pessoa */}
      <TabelaGeral titulo="Por pessoa" colPrimeira="Pessoa" linhas={(data?.por_pessoa || []).map((p) => ({
        label: p.label, extra: p.area || '—', horas: p.horas, vp: p.valor_projetado, va: p.valor_aprovado,
      }))} />

      {/* Cliente e caso lado a lado */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <TabelaSimples titulo="Por cliente" linhas={data?.por_cliente || []} />
        <TabelaSimples titulo="Por caso" linhas={data?.por_caso || []} />
      </div>
    </div>
  )
}

function TabelaGeral({ titulo, colPrimeira, linhas }: {
  titulo: string; colPrimeira: string
  linhas: { label: string; extra: string; horas: number; vp: number; va: number }[]
}) {
  return (
    <div className="rounded-lg border border-hairline bg-white p-4">
      <p className="text-eyebrow mb-3">{titulo}</p>
      {linhas.length === 0 ? (
        <p className="text-sm text-ink-mute">Sem dados no período</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-mute">
                <th className="pb-1 font-medium">{colPrimeira}</th>
                <th className="pb-1 text-right font-medium">Lançadas</th>
                <th className="pb-1 text-right font-medium">Proj. (R$)</th>
                <th className="pb-1 text-right font-medium">Aprov. (R$)</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l, i) => (
                <tr key={`${l.label}-${i}`} className="border-t border-hairline">
                  <td className="max-w-0 py-1.5 pr-2">
                    <div className="truncate text-ink-secondary" title={l.label}>{l.label}</div>
                    <div className="truncate text-xs text-ink-mute">{l.extra}</div>
                  </td>
                  <td className="whitespace-nowrap py-1.5 text-right font-tabular">{horas(l.horas)}</td>
                  <td className="whitespace-nowrap py-1.5 pl-2 text-right font-tabular text-ink">{money(l.vp)}</td>
                  <td className="whitespace-nowrap py-1.5 pl-2 text-right font-tabular text-emerald-700">{money(l.va)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function TabelaSimples({ titulo, linhas }: { titulo: string; linhas: LinhaSimples[] }) {
  return (
    <div className="rounded-lg border border-hairline bg-white p-4">
      <p className="text-eyebrow mb-3">{titulo}</p>
      {linhas.length === 0 ? (
        <p className="text-sm text-ink-mute">Sem horas no período</p>
      ) : (
        <table className="w-full text-sm">
          <tbody>
            {linhas.map((l, i) => (
              <tr key={`${l.label}-${i}`} className="border-t border-hairline first:border-t-0">
                <td className="max-w-0 truncate py-1.5 pr-2 text-ink-secondary" title={l.label}>{l.label}</td>
                <td className="whitespace-nowrap py-1.5 text-right font-tabular">{horas(l.horas)}</td>
                <td className="whitespace-nowrap py-1.5 pl-2 text-right font-tabular text-ink">{money(l.valor_projetado)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
