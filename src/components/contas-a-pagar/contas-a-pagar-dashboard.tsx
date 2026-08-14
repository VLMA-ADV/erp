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
  vencimento_original?: string | null
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

// Janela de leitura do mes (pedido Filipe 13/08): "ali eu vejo geral, mas eu
// quero poder apertar um botao tipo on off pra ver o diario ou semanal, ou ate
// mesmo uma barra de intervalo de dias — tipo 3 dias".
//
// A janela e um RECORTE do mes ja carregado, nao uma consulta nova: o mes
// inteiro vem numa chamada so e o saldo projetado e acumulado desde o dia 1.
// Recortar aqui mantem o saldo certo (ele continua sendo o acumulado do mes) e
// nao gasta ida ao servidor a cada clique. Buscar so a janela no banco daria um
// saldo que comeca do zero no meio do mes — numero errado.
const JANELAS = [
  { key: 'mes', label: 'Mês', dias: 0 },
  { key: 'semana', label: 'Semana', dias: 7 },
  { key: 'tres', label: '3 dias', dias: 3 },
  { key: 'dia', label: 'Dia', dias: 1 },
] as const
type JanelaKey = (typeof JANELAS)[number]['key']

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
  const [janela, setJanela] = useState<JanelaKey>('mes')
  // Primeiro dia da janela. Null = ainda nao ancorada; ancora sozinha em hoje
  // (ou no dia 1, se o mes escolhido nao for o corrente).
  const [janelaInicio, setJanelaInicio] = useState<string | null>(null)

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
  // Simulacao de fluxo (pedido Filipe 13/08): arrasta a conta para outro dia,
  // ve o caixa mudar, e so entao confirma. Enquanto nao confirma, nada foi
  // gravado — quem recalcula e o servidor, com a mesma regra do grafico.
  const [simulacao, setSimulacao] = useState<Record<string, string>>({})
  const [arrastando, setArrastando] = useState<string | null>(null)
  // Caminho sem arrastar (Filipe, 14/08: "nao consegui mover pra cima e baixo").
  // Arrastar em HTML depende de pegar a linha num ponto que nao seja botao, e a
  // linha tem quatro botoes do lado direito — quem pega ali nao arrasta nada, e
  // nao ha nenhum aviso de que da para arrastar. Entao a linha ganhou um botao
  // "mover": clica nele, clica no dia. O arrastar continua funcionando para
  // quem preferir.
  const [selecionado, setSelecionado] = useState<string | null>(null)
  const [aplicando, setAplicando] = useState(false)

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

  const loadMes = useCallback(async (mes: string, sim: Record<string, string> = {}) => {
    try {
      setLoading(true)
      setError(null)
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setError('Sessão expirada.'); return }
      const { data: r, error: e } = await supabase.rpc('cp_fluxo_mensal', {
        p_user_id: user.id,
        p_mes: `${mes}-01`,
        p_simulacao: Object.entries(sim).map(([id, vencimento]) => ({ id, vencimento })),
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
    if (modo === 'mes') void loadMes(mesRef, simulacao)
    else void load(dia)
  }, [canRead, ready, modo, mesRef, dia, simulacao, load, loadMes])

  // Recarrega o que estiver na tela — usado depois de baixar/editar/excluir.
  const recarregar = useCallback(() => {
    if (modo === 'mes') void loadMes(mesRef, simulacao)
    else void load(dia)
  }, [modo, mesRef, dia, simulacao, load, loadMes])

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

  // Trocou de mês: a âncora da janela some, para não ficar apontando um dia que
  // não existe mais no mês novo.
  useEffect(() => { setJanelaInicio(null) }, [mesRef])

  const janelaTam = JANELAS.find((j) => j.key === janela)?.dias ?? 0

  // Onde a janela começa. Sem âncora escolhida, ela cai em hoje quando o mês
  // exibido é o corrente — é o dia que o financeiro quer ver ao apertar "Dia" —
  // e no dia 1 nos outros meses.
  const janelaDe = useMemo(() => {
    if (janelaTam === 0 || !fluxo) return null
    if (janelaInicio) return janelaInicio
    const hoje = todayIso()
    return hoje >= fluxo.mes_inicio && hoje <= fluxo.mes_fim ? hoje : fluxo.mes_inicio
  }, [janelaTam, janelaInicio, fluxo])

  const janelaAte = janelaDe ? shiftIso(janelaDe, janelaTam - 1) : null

  // O dia em que a linha de fato pesa no caixa. Igual ao GREATEST do servidor:
  // atrasado de mês anterior é cobrado no dia 1, então é no dia 1 que ele tem de
  // aparecer — senão a coluna não bate com a linha do gráfico logo acima.
  const diaEfetivo = useCallback(
    (r: Row) => (fluxo && r.vencimento < fluxo.mes_inicio ? fluxo.mes_inicio : r.vencimento),
    [fluxo],
  )

  const naJanela = useCallback(
    (r: Row) => !janelaDe || !janelaAte || (diaEfetivo(r) >= janelaDe && diaEfetivo(r) <= janelaAte),
    [janelaDe, janelaAte, diaEfetivo],
  )

  // Gráfico e KPIs recortados para a janela. O saldo projetado de cada dia já
  // vem acumulado desde o dia 1, então recortar não o distorce: o saldo inicial
  // da janela é simplesmente o saldo com que o dia anterior terminou.
  const fluxoJanela = useMemo<FluxoMensal | null>(() => {
    if (!fluxo) return null
    if (!janelaDe || !janelaAte) return fluxo
    const dias = fluxo.dias.filter((d) => d.data >= janelaDe && d.data <= janelaAte)
    if (dias.length === 0) return fluxo
    const anterior = [...fluxo.dias].reverse().find((d) => d.data < janelaDe)
    return {
      ...fluxo,
      dias,
      saldo_inicial: anterior ? Number(anterior.saldo_projetado) : Number(fluxo.saldo_inicial),
      saldo_final: Number(dias[dias.length - 1].saldo_projetado),
      total_pagar: dias.reduce((s, d) => s + Number(d.pagar), 0),
      total_receber: dias.reduce((s, d) => s + Number(d.receber), 0),
      // O aviso de atrasado pertence ao dia 1; fora dele seria um alerta sobre
      // dinheiro que não está na tela.
      atrasado_anterior: dias.some((d) => d.data === fluxo.mes_inicio)
        ? fluxo.atrasado_anterior
        : { pagar: 0, receber: 0 },
    }
  }, [fluxo, janelaDe, janelaAte])

  const moverJanela = (passos: number) => {
    if (!janelaDe || !fluxo) return
    const alvo = shiftIso(janelaDe, passos * janelaTam)
    // Não deixa a janela sair do mês carregado — fora dele não há dado nem saldo
    // acumulado, e o gráfico ficaria vazio sem explicar por quê.
    if (alvo < fluxo.mes_inicio) { setJanelaInicio(fluxo.mes_inicio); return }
    if (alvo > fluxo.mes_fim) return
    setJanelaInicio(alvo)
  }

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

  const moverPara = (id: string, novaData: string) => {
    setSimulacao((prev) => {
      const row = [...(pagar as Row[]), ...(receber as Row[])].find((r) => r.id === id)
      const original = row?.vencimento_original || row?.vencimento
      const proximo = { ...prev }
      // Voltar para a data original tira do rascunho em vez de guardar um
      // "movimento" que nao move nada.
      if (original === novaData) delete proximo[id]
      else proximo[id] = novaData
      return proximo
    })
  }

  const descartarSimulacao = () => setSimulacao({})

  const aplicarSimulacao = async () => {
    const mudancas = Object.entries(simulacao)
    if (mudancas.length === 0) return
    if (!window.confirm(`Aplicar ${mudancas.length} mudança(s) de data? As contas passam a vencer nas novas datas.`)) return

    setAplicando(true)
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      let falhas = 0
      for (const [id, novaData] of mudancas) {
        // cp_reagendar ja existe, valida e guarda o de-para em reagendado_de.
        const { error: e } = await supabase.rpc('cp_reagendar', { p_user_id: user.id, p_id: id, p_nova_data: novaData })
        if (e) falhas += 1
      }
      if (falhas > 0) alert(`${falhas} conta(s) não puderam ser reagendadas.`)
      setSimulacao({})
      void loadMes(mesRef, {})
    } finally {
      setAplicando(false)
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
  const recorta = (rows: Row[]) => (modo === 'mes' ? applyFilter(rows).filter(naJanela) : applyFilter(rows))
  const pagar = useMemo(() => (fonte ? recorta(fonte.pagar as Row[]) : []), [fonte, filtro, dia, modo, naJanela])
  const receber = useMemo(() => (fonte ? recorta(fonte.receber as Row[]) : []), [fonte, filtro, dia, modo, naJanela])

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

      {/* Janela de leitura dentro do mês (pedido Filipe 13/08). O mês continua
          carregado por baixo — isto só decide quanto dele aparece de uma vez. */}
      {modo === 'mes' ? (
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded-md border border-hairline p-1">
            {JANELAS.map((j) => (
              <button key={j.key} onClick={() => setJanela(j.key)}
                className={`rounded px-3 py-1 text-sm ${janela === j.key ? 'bg-secondary font-medium text-ink' : 'text-ink-mute hover:bg-canvas-soft'}`}>
                {j.label}
              </button>
            ))}
          </div>

          {janelaDe && janelaAte ? (
            <div className="flex items-center gap-2">
              <button onClick={() => moverJanela(-1)} disabled={janelaDe <= (fluxo?.mes_inicio || '')}
                className="rounded-md border border-hairline px-2.5 py-1 text-sm hover:bg-canvas-soft disabled:opacity-40">‹</button>
              <span className="font-tabular text-sm text-ink-secondary">
                {janelaTam === 1 ? fmtDate(janelaDe) : `${fmtDate(janelaDe)} a ${fmtDate(janelaAte)}`}
              </span>
              <button onClick={() => moverJanela(1)} disabled={janelaAte >= (fluxo?.mes_fim || '')}
                className="rounded-md border border-hairline px-2.5 py-1 text-sm hover:bg-canvas-soft disabled:opacity-40">›</button>
              <button onClick={() => setJanelaInicio(null)} className="text-sm text-primary hover:underline">hoje</button>
            </div>
          ) : (
            <span className="text-sm text-ink-mute">Mês inteiro</span>
          )}
        </div>
      ) : null}

      {error && <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">{error}</div>}

      {/* KPIs */}
      {modo === 'mes' ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-hairline bg-white p-4">
            <p className="text-xs uppercase tracking-wide text-ink-mute">A pagar {janelaTam === 0 ? 'no mês' : 'no período'}</p>
            <p className="mt-1 text-2xl font-semibold text-red-600">{fmtMoney(fluxoJanela?.total_pagar)}</p>
          </div>
          <div className="rounded-lg border border-hairline bg-white p-4">
            <p className="text-xs uppercase tracking-wide text-ink-mute">A receber {janelaTam === 0 ? 'no mês' : 'no período'}</p>
            <p className="mt-1 text-2xl font-semibold text-green-600">{fmtMoney(fluxoJanela?.total_receber)}</p>
          </div>
          <div className="rounded-lg border border-hairline bg-white p-4">
            <p className="text-xs uppercase tracking-wide text-ink-mute">
              Saldo projetado {janelaTam === 0 ? 'no fim do mês' : 'no fim do período'}
            </p>
            <p className={`mt-1 text-2xl font-semibold ${Number(fluxoJanela?.saldo_final ?? 0) < 0 ? 'text-red-600' : 'text-ink'}`}>
              {fmtMoney(fluxoJanela?.saldo_final)}
            </p>
            <p className="mt-1 text-xs text-ink-mute">
              {janelaTam === 0 ? 'Começou o mês' : 'Começou o período'} com {fmtMoney(fluxoJanela?.saldo_inicial)}
            </p>
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

      {modo === 'mes' && fluxoJanela ? <FluxoMensalChart fluxo={fluxoJanela} /> : null}

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

      {/* Rascunho da simulação: aparece só quando há mudança pendente. Nada foi
          gravado até apertar Confirmar — foi o que o Filipe pediu ("vejo um
          rascunho e aplico mediante confirmação"). */}
      {modo === 'mes' && Object.keys(simulacao).length > 0 ? (
        <div className="sticky top-2 z-10 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 shadow-sm">
          <p className="text-sm text-amber-900">
            <strong>Rascunho:</strong> {Object.keys(simulacao).length} conta(s) movida(s) de data.
            O gráfico acima já mostra como o caixa fica. Nada foi salvo ainda.
          </p>
          <div className="flex items-center gap-2">
            <button onClick={descartarSimulacao} disabled={aplicando}
              className="rounded-md border border-hairline bg-white px-4 py-2 text-sm hover:bg-canvas-soft disabled:opacity-50">
              Cancelar
            </button>
            <button onClick={() => void aplicarSimulacao()} disabled={aplicando}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
              {aplicando ? 'Aplicando…' : 'Confirmar'}
            </button>
          </div>
        </div>
      ) : null}

      {/* Faixa de dias: alvo do arraste E do clique. Aparece quando há uma
          conta em movimento — arrastada ou escolhida no botão "mover" — para
          não ocupar espaço o tempo todo. */}
      {modo === 'mes' && (arrastando || selecionado) ? (
        <div className="sticky top-2 z-20 rounded-lg border border-primary bg-white p-3 shadow-lg">
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="text-xs font-medium text-ink">
              {selecionado ? 'Clique no dia em que essa conta deve cair' : 'Solte no dia em que quer que essa conta caia'}
            </p>
            {selecionado ? (
              <button onClick={() => setSelecionado(null)}
                className="text-xs text-ink-mute underline hover:text-ink">
                cancelar
              </button>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-1">
            {(fluxo?.dias || []).map((d) => (
              <button
                key={d.data}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault()
                  const id = e.dataTransfer.getData('text/plain') || arrastando
                  if (id) moverPara(id, d.data)
                  setArrastando(null)
                }}
                onClick={() => {
                  if (!selecionado) return
                  moverPara(selecionado, d.data)
                  setSelecionado(null)
                }}
                className="h-9 w-9 rounded-md border border-hairline text-xs text-ink-secondary hover:border-primary hover:bg-primary/10"
              >
                {Number(d.data.slice(8, 10))}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* Listas */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ListaColuna titulo="Contas a Pagar" cor="red" rows={pagar} loading={loading} canWrite={canWrite}
          onReagendar={reagendar} onBaixar={(id) => baixar(id, 'pagar')} onExcluir={excluir}
          editandoValor={editandoValor} valorDraft={valorDraft} salvandoValor={salvandoValor}
          onAbrirValor={(r) => { setEditandoValor(r.id); setValorDraft(String(r.valor)) }}
          onMudarValor={setValorDraft} onSalvarValor={salvarValor} onCancelarValor={() => setEditandoValor(null)}
          arrastavel={modo === 'mes'} simulacao={simulacao} onArrastar={setArrastando}
          selecionado={selecionado} onSelecionar={setSelecionado} />
        <ListaColuna titulo="Contas a Receber" cor="green" rows={receber} loading={loading} canWrite={canWrite}
          onReagendar={reagendar} onBaixar={(id) => baixar(id, 'receber')} onExcluir={excluir}
          editandoValor={editandoValor} valorDraft={valorDraft} salvandoValor={salvandoValor}
          onAbrirValor={(r) => { setEditandoValor(r.id); setValorDraft(String(r.valor)) }}
          onMudarValor={setValorDraft} onSalvarValor={salvarValor} onCancelarValor={() => setEditandoValor(null)}
          arrastavel={modo === 'mes'} simulacao={simulacao} onArrastar={setArrastando}
          selecionado={selecionado} onSelecionar={setSelecionado} />
      </div>
    </div>
  )
}

function ListaColuna({
  titulo, cor, rows, loading, canWrite, onReagendar, onBaixar, onExcluir,
  editandoValor, valorDraft, salvandoValor, onAbrirValor, onMudarValor, onSalvarValor, onCancelarValor,
  arrastavel, simulacao, onArrastar, selecionado, onSelecionar,
}: {
  titulo: string; cor: 'red' | 'green'; rows: Row[]; loading: boolean; canWrite: boolean
  onReagendar: (id: string) => void; onBaixar: (id: string) => void
  onExcluir: (id: string, descricao: string) => void
  editandoValor: string | null; valorDraft: string; salvandoValor: boolean
  onAbrirValor: (row: Row) => void; onMudarValor: (v: string) => void
  onSalvarValor: (row: Row) => void; onCancelarValor: () => void
  arrastavel: boolean; simulacao: Record<string, string>; onArrastar: (id: string | null) => void
  selecionado: string | null; onSelecionar: (id: string | null) => void
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
            <li
              key={r.id}
              draggable={arrastavel && canWrite && !['pago', 'recebido', 'cancelado'].includes(r.status)}
              onDragStart={(e) => { e.dataTransfer.setData('text/plain', r.id); onArrastar(r.id) }}
              onDragEnd={() => onArrastar(null)}
              className={`flex items-center justify-between gap-3 p-4 ${
                simulacao[r.id] ? 'border-l-4 border-amber-400 bg-amber-50/50' : ''
              } ${selecionado === r.id ? 'bg-primary/5 ring-1 ring-inset ring-primary' : ''} ${
                arrastavel && canWrite && !['pago', 'recebido', 'cancelado'].includes(r.status) ? 'cursor-grab active:cursor-grabbing' : ''
              }`}
            >
              <div className="flex min-w-0 items-start gap-2">
                {arrastavel && canWrite && !['pago', 'recebido', 'cancelado'].includes(r.status) ? (
                  <button
                    onClick={() => onSelecionar(selecionado === r.id ? null : r.id)}
                    title="Mover esta conta para outro dia"
                    aria-label="Mover para outro dia"
                    className={`mt-0.5 shrink-0 rounded border px-1.5 py-1 text-xs leading-none ${
                      selecionado === r.id
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-hairline text-ink-mute hover:border-primary hover:text-primary'
                    }`}
                  >
                    ⠿
                  </button>
                ) : null}
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink">
                  {r.descricao}
                  {simulacao[r.id] ? (
                    <span className="ml-2 rounded-full bg-amber-200 px-2 py-0.5 text-[10px] font-medium text-amber-900">
                      movida de {fmtDate(r.vencimento_original)}
                    </span>
                  ) : null}
                </p>
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
