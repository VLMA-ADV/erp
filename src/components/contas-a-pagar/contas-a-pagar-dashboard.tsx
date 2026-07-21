'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { usePermissionsContext } from '@/lib/contexts/permissions-context'

// ── helpers ───────────────────────────────────────────────────────────
function fmtMoney(value: number | string | null | undefined) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0))
}
function fmtDate(value: string | null | undefined) {
  if (!value) return '-'
  const [y, m, d] = value.split('-')
  return y && m && d ? `${d}/${m}/${y}` : value
}
function todayIso() {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
function shiftIso(iso: string, days: number) {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + days)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`
}

type Row = {
  id: string
  descricao: string
  fornecedor_nome?: string | null
  empresa_nome?: string | null
  conta_codigo?: string | null
  plano_grupo?: string | null
  centro_nome?: string | null
  valor: number
  vencimento: string
  status: string
  reembolsavel?: boolean
  reembolso_de_id?: string | null
}
type Rotina = {
  data: string
  kpis: { despesas_dia: number; receitas_dia: number; saldo_dia: number; saldo_corrente: number }
  pagar: Row[]
  receber: Row[]
}

const STATUS_STYLE: Record<string, string> = {
  pendente: 'bg-secondary text-ink-secondary',
  agendado: 'bg-blue-100 text-blue-700',
  pago: 'bg-green-100 text-green-700',
  recebido: 'bg-green-100 text-green-700',
  atrasado: 'bg-red-100 text-red-700',
  remanejado: 'bg-amber-100 text-amber-700',
  cancelado: 'bg-secondary text-ink-mute line-through',
}

const FILTERS = [
  { key: 'todas', label: 'Todas' },
  { key: 'pendentes', label: 'Pendentes' },
  { key: 'vencidas', label: 'Vencidas' },
  { key: 'pagos', label: 'Pagos/Baixados' },
] as const

export default function ContasAPagarDashboard() {
  const { hasPermission } = usePermissionsContext()
  const canRead = hasPermission('finance.contas_pagar.read')
  const canWrite = hasPermission('finance.contas_pagar.write')

  const [dia, setDia] = useState(todayIso())
  const [data, setData] = useState<Rotina | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filtro, setFiltro] = useState<(typeof FILTERS)[number]['key']>('todas')
  const [ready, setReady] = useState(false)
  const [conta, setConta] = useState<{ id: string; banco: string; descricao: string | null; saldo_abertura: number } | null>(null)
  const [saldoInput, setSaldoInput] = useState('')

  const load = useCallback(async (d: string) => {
    try {
      setLoading(true)
      setError(null)
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setError('Sessão expirada.'); return }
      const { data: r, error: e } = await supabase.rpc('cp_rotina_diaria', { p_user_id: user.id, p_data: d })
      if (e) { setError(e.message); return }
      setData(r as Rotina)
    } catch (err) {
      console.error(err)
      setError('Erro ao carregar a rotina diária.')
    } finally {
      setLoading(false)
    }
  }, [])

  // Sync do faturamento (notas emitidas → contas a receber) uma vez ao abrir,
  // + carrega a conta bancária para edição do saldo inicial.
  useEffect(() => {
    if (!canRead) { setReady(true); return }
    void (async () => {
      try {
        const supabase = createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
          await supabase.rpc('cp_sync_faturamento', { p_user_id: user.id })
          const { data: listas } = await supabase.rpc('cp_listas', { p_user_id: user.id })
          const cb = (listas as any)?.contas_bancarias?.[0]
          if (cb) { setConta(cb); setSaldoInput(String(cb.saldo_abertura ?? '')) }
        }
      } catch { /* best-effort */ }
      setReady(true)
    })()
  }, [canRead])

  useEffect(() => {
    if (!canRead || !ready) return
    void load(dia)
  }, [canRead, ready, dia, load])

  const salvarSaldo = async () => {
    if (!conta) return
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { error: e } = await supabase.rpc('cp_set_saldo_conta', {
      p_user_id: user.id, p_conta_id: conta.id, p_saldo: Number(saldoInput || 0), p_data: todayIso(),
    })
    if (e) { alert(e.message); return }
    void load(dia)
  }

  const applyFilter = (rows: Row[]) => {
    switch (filtro) {
      case 'pendentes': return rows.filter((r) => ['pendente', 'agendado'].includes(r.status))
      case 'vencidas': return rows.filter((r) => r.status === 'atrasado' || (r.vencimento < dia && !['pago', 'recebido', 'cancelado'].includes(r.status)))
      case 'pagos': return rows.filter((r) => ['pago', 'recebido'].includes(r.status))
      default: return rows
    }
  }

  const reagendar = async (id: string) => {
    const nova = window.prompt('Reagendar para qual data? (AAAA-MM-DD)', shiftIso(dia, 3))
    if (!nova) return
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { error: e } = await supabase.rpc('cp_reagendar', { p_user_id: user.id, p_id: id, p_nova_data: nova })
    if (e) { alert(e.message); return }
    void load(dia)
  }

  const baixar = async (id: string, natureza: 'pagar' | 'receber') => {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const status = natureza === 'pagar' ? 'pago' : 'recebido'
    const { error: e } = await supabase.rpc('cp_dar_baixa', {
      p_user_id: user.id, p_id: id, p_status: status, p_data: todayIso(), p_valor: null, p_conta_id: null,
    })
    if (e) { alert(e.message); return }
    void load(dia)
  }

  const pagar = useMemo(() => (data ? applyFilter(data.pagar) : []), [data, filtro, dia])
  const receber = useMemo(() => (data ? applyFilter(data.receber) : []), [data, filtro, dia])

  if (!canRead) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4">
        <p className="text-sm text-destructive">Você não tem permissão para acessar o financeiro.</p>
      </div>
    )
  }

  const k = data?.kpis

  return (
    <div className="space-y-6">
      {/* Navegador de data */}
      <div className="flex items-center gap-3">
        <button onClick={() => setDia(shiftIso(dia, -1))} className="rounded-md border border-hairline px-3 py-1.5 text-sm hover:bg-canvas-soft">‹</button>
        <input type="date" value={dia} onChange={(e) => setDia(e.target.value || todayIso())} className="rounded-md border border-hairline px-3 py-1.5 text-sm" />
        <button onClick={() => setDia(shiftIso(dia, 1))} className="rounded-md border border-hairline px-3 py-1.5 text-sm hover:bg-canvas-soft">›</button>
        <button onClick={() => setDia(todayIso())} className="text-sm text-primary hover:underline">hoje</button>
      </div>

      {error && <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">{error}</div>}

      {/* KPIs */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-hairline bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-ink-mute">Despesas do dia</p>
          <p className="mt-1 text-2xl font-semibold text-red-600">{fmtMoney(k?.despesas_dia)}</p>
        </div>
        <div className="rounded-lg border border-hairline bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-ink-mute">Receitas do dia</p>
          <p className="mt-1 text-2xl font-semibold text-green-600">{fmtMoney(k?.receitas_dia)}</p>
        </div>
        <div className="rounded-lg border border-hairline bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-ink-mute">Saldo corrente</p>
          <p className="mt-1 text-2xl font-semibold text-ink">{fmtMoney(k?.saldo_corrente)}</p>
          <p className="mt-1 text-xs text-ink-mute">Saldo do dia: {fmtMoney(k?.saldo_dia)}</p>
        </div>
      </div>

      {/* Saldo inicial manual (sem conciliação) */}
      {canWrite && conta && (
        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-hairline bg-white p-4">
          <div>
            <label className="mb-1 block text-xs uppercase tracking-wide text-ink-mute">Saldo inicial — {conta.banco}{conta.descricao ? ` (${conta.descricao})` : ''}</label>
            <input type="number" step="0.01" value={saldoInput} onChange={(e) => setSaldoInput(e.target.value)}
              className="rounded-md border border-hairline px-3 py-2 text-sm" placeholder="0,00" />
          </div>
          <button onClick={salvarSaldo} className="rounded-md border border-hairline px-3 py-2 text-sm hover:bg-canvas-soft">Salvar saldo</button>
          <span className="text-xs text-ink-mute">Base do saldo corrente. Lançado manualmente (sem conciliação bancária).</span>
        </div>
      )}

      {/* Filtros */}
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFiltro(f.key)}
            className={`rounded-full px-3 py-1 text-sm ${filtro === f.key ? 'bg-primary text-primary-foreground' : 'border border-hairline text-ink-mute hover:bg-canvas-soft'}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Listas */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ListaColuna titulo="Contas a Pagar" cor="red" rows={pagar} loading={loading} canWrite={canWrite}
          onReagendar={reagendar} onBaixar={(id) => baixar(id, 'pagar')} />
        <ListaColuna titulo="Contas a Receber" cor="green" rows={receber} loading={loading} canWrite={canWrite}
          onReagendar={reagendar} onBaixar={(id) => baixar(id, 'receber')} />
      </div>
    </div>
  )
}

function ListaColuna({
  titulo, cor, rows, loading, canWrite, onReagendar, onBaixar,
}: {
  titulo: string; cor: 'red' | 'green'; rows: Row[]; loading: boolean; canWrite: boolean
  onReagendar: (id: string) => void; onBaixar: (id: string) => void
}) {
  const total = rows.reduce((s, r) => s + Number(r.valor || 0), 0)
  return (
    <div className="rounded-lg border border-hairline bg-white">
      <div className="flex items-center justify-between border-b border-hairline p-4">
        <span className="flex items-center gap-2 font-semibold text-ink">
          <span className={`h-2.5 w-2.5 rounded-sm ${cor === 'red' ? 'bg-red-500' : 'bg-green-500'}`} />
          {titulo}
        </span>
        <span className="font-semibold text-ink">{fmtMoney(total)}</span>
      </div>
      {loading ? (
        <p className="p-6 text-sm text-ink-mute">Carregando…</p>
      ) : rows.length === 0 ? (
        <p className="p-6 text-sm text-ink-mute">Nada para este dia/filtro.</p>
      ) : (
        <ul className="divide-y divide-hairline">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink">{r.descricao}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-mute">
                  {r.empresa_nome && <span className="rounded bg-secondary px-1.5 py-0.5">{r.empresa_nome}</span>}
                  {r.centro_nome && <span className="rounded bg-secondary px-1.5 py-0.5">{r.centro_nome}</span>}
                  {/* categoria = conta do Plano de Contas (grupo no tooltip) */}
                  {r.conta_codigo && (
                    <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-800" title={r.plano_grupo || undefined}>
                      {r.conta_codigo}
                    </span>
                  )}
                  <span>· {fmtDate(r.vencimento)}</span>
                  {r.reembolsavel && <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-indigo-700">reembolsável</span>}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <div className="text-right">
                  <p className="text-sm font-semibold text-ink">{fmtMoney(r.valor)}</p>
                  <span className={`mt-0.5 inline-block rounded px-1.5 py-0.5 text-[11px] ${STATUS_STYLE[r.status] || 'bg-secondary text-ink-secondary'}`}>{r.status}</span>
                </div>
                {canWrite && !['pago', 'recebido', 'cancelado'].includes(r.status) && (
                  <div className="flex flex-col gap-1">
                    <button onClick={() => onBaixar(r.id)} title="Dar baixa" className="rounded border border-hairline px-2 py-0.5 text-xs hover:bg-canvas-soft">baixar</button>
                    <button onClick={() => onReagendar(r.id)} title="Reagendar" className="rounded border border-hairline px-2 py-0.5 text-xs hover:bg-canvas-soft">reagendar</button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
