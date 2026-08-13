'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import FluxoMensalChart, { type FluxoMensal } from './fluxo-mensal-chart'
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

  // Pedido Filipe 12/08: a tela passa a abrir no MES (barra de meses + grafico
  // com todos os dias). O modo dia continua disponivel — e a rotina que o
  // financeiro ja usava todo dia, tirar seria trocar uma coisa pela outra.
  const [modo, setModo] = useState<'mes' | 'dia'>('mes')
  const [mesRef, setMesRef] = useState(() => todayIso().slice(0, 7))
  const [fluxo, setFluxo] = useState<FluxoMensal | null>(null)

  const [dia, setDia] = useState(todayIso())
  const [data, setData] = useState<Rotina | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filtro, setFiltro] = useState<(typeof FILTERS)[number]['key']>('todas')
  const [ready, setReady] = useState(false)
  // Enquanto existia so o Itau, pegar a primeira conta bastava. Com a Cora
  // cadastrada isso passou a editar a conta errada sem avisar — agora a conta e
  // escolhida, e o saldo mostrado e sempre o da conta escolhida.
  type ContaBancaria = { id: string; banco: string; descricao: string | null; saldo_abertura: number }
  const [contas, setContas] = useState<ContaBancaria[]>([])
  const [contaId, setContaId] = useState('')
  const [saldoSujo, setSaldoSujo] = useState(false)
  const [saldoInput, setSaldoInput] = useState('')
  const [editandoValor, setEditandoValor] = useState<string | null>(null)
  const [valorDraft, setValorDraft] = useState('')
  const [salvandoValor, setSalvandoValor] = useState(false)

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

  const loadMes = useCallback(async (mes: string) => {
    try {
      setLoading(true)
      setError(null)
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setError('Sessão expirada.'); return }
      const { data: r, error: e } = await supabase.rpc('cp_fluxo_mensal', {
        p_user_id: user.id,
        p_mes: `${mes}-01`,
      })
      if (e) { setError(e.message); return }
      setFluxo(r as FluxoMensal)
    } catch (err) {
      console.error(err)
      setError('Erro ao carregar o fluxo do mês.')
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
          const lista = ((listas as any)?.contas_bancarias || []) as ContaBancaria[]
          setContas(lista)
          if (lista[0]) { setContaId(lista[0].id); setSaldoInput(String(lista[0].saldo_abertura ?? '')) }
        }
      } catch { /* best-effort */ }
      setReady(true)
    })()
  }, [canRead])

  useEffect(() => {
    if (!canRead || !ready) return
    if (modo === 'mes') void loadMes(mesRef)
    else void load(dia)
  }, [canRead, ready, modo, mesRef, dia, load, loadMes])

  // Recarrega o que estiver na tela — usado depois de baixar/editar/excluir.
  const recarregar = useCallback(() => {
    if (modo === 'mes') void loadMes(mesRef)
    else void load(dia)
  }, [modo, mesRef, dia, load, loadMes])

  const mesOptions = useMemo(() => {
    const opts: Array<{ value: string; label: string }> = []
    const hoje = new Date()
    // 12 meses para tras e 6 para frente: o financeiro confere o passado e
    // projeta o que ja esta agendado adiante.
    for (let i = -12; i <= 6; i++) {
      const d = new Date(hoje.getFullYear(), hoje.getMonth() + i, 1)
      opts.push({
        value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
        label: d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }).replace('.', ''),
      })
    }
    return opts
  }, [])

  const conta = contas.find((c) => c.id === contaId) || null

  const trocarConta = (id: string) => {
    const alvo = contas.find((c) => c.id === id)
    setContaId(id)
    setSaldoInput(String(alvo?.saldo_abertura ?? ''))
    setSaldoSujo(false)
  }

  const salvarSaldo = async () => {
    if (!conta) return
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { error: e } = await supabase.rpc('cp_set_saldo_conta', {
      p_user_id: user.id, p_conta_id: conta.id, p_saldo: Number(saldoInput || 0), p_data: todayIso(),
    })
    if (e) { alert(e.message); return }
    setContas((prev) => prev.map((c) => (c.id === conta.id ? { ...c, saldo_abertura: Number(saldoInput || 0) } : c)))
    setSaldoSujo(false)
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

  // Editar o valor na propria linha (pedido Filipe 12/08). Mexe SO nesta
  // parcela: cp_editar_lancamento filtra por id, entao as outras parcelas da
  // mesma recorrencia nao se movem — era exatamente o medo dele.
  const salvarValor = async (row: Row) => {
    const novo = Number(String(valorDraft).replace(',', '.'))
    if (!Number.isFinite(novo) || novo <= 0) { alert('Informe um valor maior que zero.'); return }
    if (novo === Number(row.valor)) { setEditandoValor(null); return }

    setSalvandoValor(true)
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { error: e } = await supabase.rpc('cp_editar_lancamento', {
        p_user_id: user.id,
        p_id: row.id,
        p_payload: { descricao: row.descricao, valor: novo, vencimento: row.vencimento },
      })
      if (e) { alert(e.message); return }
      setEditandoValor(null)
      recarregar()
    } finally {
      setSalvandoValor(false)
    }
  }

  const excluir = async (id: string, descricao: string) => {
    if (!window.confirm(`Excluir "${descricao}"?\n\nSe ele gerou um reembolso automático, o reembolso é cancelado junto.`)) return
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { error: e } = await supabase.rpc('cp_excluir_lancamento', { p_user_id: user.id, p_id: id })
    if (e) { alert(e.message); return }
    recarregar()
  }

  const reagendar = async (id: string) => {
    const nova = window.prompt('Reagendar para qual data? (AAAA-MM-DD)', shiftIso(dia, 3))
    if (!nova) return
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { error: e } = await supabase.rpc('cp_reagendar', { p_user_id: user.id, p_id: id, p_nova_data: nova })
    if (e) { alert(e.message); return }
    recarregar()
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
    recarregar()
  }

  // No modo mes as listas vem do fluxo mensal; no modo dia, da rotina diaria.
  const fonte = modo === 'mes' ? fluxo : data
  const pagar = useMemo(() => (fonte ? applyFilter(fonte.pagar as Row[]) : []), [fonte, filtro, dia])
  const receber = useMemo(() => (fonte ? applyFilter(fonte.receber as Row[]) : []), [fonte, filtro, dia])

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
      {/* Mês x Dia. O mês é o padrão (pedido Filipe 12/08); o dia continua para
          a rotina diária que o financeiro já usava. */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-md border border-hairline p-1">
          {(['mes', 'dia'] as const).map((m) => (
            <button key={m} onClick={() => setModo(m)}
              className={`rounded px-4 py-1.5 text-sm font-medium ${modo === m ? 'bg-primary text-primary-foreground' : 'text-ink-mute hover:bg-canvas-soft'}`}>
              {m === 'mes' ? 'Mês' : 'Dia'}
            </button>
          ))}
        </div>

        {modo === 'mes' ? (
          <div className="flex flex-wrap items-center gap-1 overflow-x-auto">
            {mesOptions.map((m) => (
              <button key={m.value} onClick={() => setMesRef(m.value)}
                className={`shrink-0 rounded-full px-3 py-1 text-sm capitalize ${
                  mesRef === m.value
                    ? 'bg-primary text-primary-foreground'
                    : 'border border-hairline text-ink-mute hover:bg-canvas-soft'
                }`}>
                {m.label}
              </button>
            ))}
          </div>
        ) : (
          <>
            <button onClick={() => setDia(shiftIso(dia, -1))} className="rounded-md border border-hairline px-3 py-1.5 text-sm hover:bg-canvas-soft">‹</button>
            <input type="date" value={dia} onChange={(e) => setDia(e.target.value || todayIso())} className="rounded-md border border-hairline px-3 py-1.5 text-sm" />
            <button onClick={() => setDia(shiftIso(dia, 1))} className="rounded-md border border-hairline px-3 py-1.5 text-sm hover:bg-canvas-soft">›</button>
            <button onClick={() => setDia(todayIso())} className="text-sm text-primary hover:underline">hoje</button>
          </>
        )}
      </div>

      {error && <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">{error}</div>}

      {/* KPIs */}
      {modo === 'mes' ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-hairline bg-white p-4">
            <p className="text-xs uppercase tracking-wide text-ink-mute">A pagar no mês</p>
            <p className="mt-1 text-2xl font-semibold text-red-600">{fmtMoney(fluxo?.total_pagar)}</p>
          </div>
          <div className="rounded-lg border border-hairline bg-white p-4">
            <p className="text-xs uppercase tracking-wide text-ink-mute">A receber no mês</p>
            <p className="mt-1 text-2xl font-semibold text-green-600">{fmtMoney(fluxo?.total_receber)}</p>
          </div>
          <div className="rounded-lg border border-hairline bg-white p-4">
            <p className="text-xs uppercase tracking-wide text-ink-mute">Saldo projetado no fim do mês</p>
            <p className={`mt-1 text-2xl font-semibold ${Number(fluxo?.saldo_final ?? 0) < 0 ? 'text-red-600' : 'text-ink'}`}>
              {fmtMoney(fluxo?.saldo_final)}
            </p>
            <p className="mt-1 text-xs text-ink-mute">Começou o mês com {fmtMoney(fluxo?.saldo_inicial)}</p>
          </div>
        </div>
      ) : (
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
      )}

      {modo === 'mes' && fluxo ? <FluxoMensalChart fluxo={fluxo} /> : null}

      {/* Saldo inicial manual (sem conciliação) */}
      {canWrite && conta && (
        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-hairline bg-white p-4">
          <div>
            <label className="mb-1 block text-xs uppercase tracking-wide text-ink-mute">Conta</label>
            <select
              value={contaId}
              onChange={(e) => trocarConta(e.target.value)}
              className="rounded-md border border-hairline px-3 py-2 text-sm"
            >
              {contas.map((c) => (
                <option key={c.id} value={c.id}>{c.banco}{c.descricao ? ` — ${c.descricao}` : ''}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs uppercase tracking-wide text-ink-mute">Saldo inicial</label>
            <input type="number" step="0.01" value={saldoInput}
              onChange={(e) => { setSaldoInput(e.target.value); setSaldoSujo(true) }}
              className="rounded-md border border-hairline px-3 py-2 text-sm" placeholder="0,00" />
          </div>
          <button onClick={salvarSaldo} disabled={!saldoSujo} className="rounded-md border border-hairline px-3 py-2 text-sm hover:bg-canvas-soft disabled:opacity-50">Salvar saldo</button>
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
          onReagendar={reagendar} onBaixar={(id) => baixar(id, 'pagar')} onExcluir={excluir}
          editandoValor={editandoValor} valorDraft={valorDraft} salvandoValor={salvandoValor}
          onAbrirValor={(r) => { setEditandoValor(r.id); setValorDraft(String(r.valor)) }}
          onMudarValor={setValorDraft} onSalvarValor={salvarValor} onCancelarValor={() => setEditandoValor(null)} />
        <ListaColuna titulo="Contas a Receber" cor="green" rows={receber} loading={loading} canWrite={canWrite}
          onReagendar={reagendar} onBaixar={(id) => baixar(id, 'receber')} onExcluir={excluir}
          editandoValor={editandoValor} valorDraft={valorDraft} salvandoValor={salvandoValor}
          onAbrirValor={(r) => { setEditandoValor(r.id); setValorDraft(String(r.valor)) }}
          onMudarValor={setValorDraft} onSalvarValor={salvarValor} onCancelarValor={() => setEditandoValor(null)} />
      </div>
    </div>
  )
}

function ListaColuna({
  titulo, cor, rows, loading, canWrite, onReagendar, onBaixar, onExcluir,
  editandoValor, valorDraft, salvandoValor, onAbrirValor, onMudarValor, onSalvarValor, onCancelarValor,
}: {
  titulo: string; cor: 'red' | 'green'; rows: Row[]; loading: boolean; canWrite: boolean
  onReagendar: (id: string) => void; onBaixar: (id: string) => void
  onExcluir: (id: string, descricao: string) => void
  editandoValor: string | null; valorDraft: string; salvandoValor: boolean
  onAbrirValor: (row: Row) => void; onMudarValor: (v: string) => void
  onSalvarValor: (row: Row) => void; onCancelarValor: () => void
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
                  {editandoValor === r.id ? (
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        step="0.01"
                        autoFocus
                        value={valorDraft}
                        onChange={(e) => onMudarValor(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') onSalvarValor(r)
                          if (e.key === 'Escape') onCancelarValor()
                        }}
                        disabled={salvandoValor}
                        className="w-28 rounded-md border border-primary px-2 py-1 text-right text-sm"
                      />
                      <button onClick={() => onSalvarValor(r)} disabled={salvandoValor}
                        title="Salvar (Enter)"
                        className="rounded border border-hairline px-1.5 py-1 text-xs hover:bg-canvas-soft disabled:opacity-50">✓</button>
                      <button onClick={onCancelarValor} disabled={salvandoValor}
                        title="Cancelar (Esc)"
                        className="rounded border border-hairline px-1.5 py-1 text-xs hover:bg-canvas-soft disabled:opacity-50">✕</button>
                    </div>
                  ) : (
                    <p className="text-sm font-semibold text-ink">
                      {fmtMoney(r.valor)}
                      {canWrite && !['pago', 'recebido', 'cancelado'].includes(r.status) ? (
                        <button
                          onClick={() => onAbrirValor(r)}
                          title="Editar valor (só este lançamento)"
                          className="ml-1.5 rounded px-1 text-xs font-normal text-ink-mute hover:bg-canvas-soft hover:text-primary"
                        >
                          ✎
                        </button>
                      ) : null}
                    </p>
                  )}
                  <span className={`mt-0.5 inline-block rounded px-1.5 py-0.5 text-[11px] ${STATUS_STYLE[r.status] || 'bg-secondary text-ink-secondary'}`}>{r.status}</span>
                </div>
                {canWrite && !['pago', 'recebido', 'cancelado'].includes(r.status) && (
                  <div className="flex flex-col gap-1">
                    <button onClick={() => onBaixar(r.id)} title="Dar baixa" className="rounded border border-hairline px-2 py-0.5 text-xs hover:bg-canvas-soft">baixar</button>
                    <button onClick={() => onReagendar(r.id)} title="Reagendar" className="rounded border border-hairline px-2 py-0.5 text-xs hover:bg-canvas-soft">reagendar</button>
                    <Link href={`/financeiro/contas-a-pagar/novo?id=${r.id}`} title="Editar" className="rounded border border-hairline px-2 py-0.5 text-center text-xs hover:bg-canvas-soft">editar</Link>
                    <button onClick={() => onExcluir(r.id, r.descricao)} title="Excluir" className="rounded border border-hairline px-2 py-0.5 text-xs text-destructive hover:bg-destructive/10">excluir</button>
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
