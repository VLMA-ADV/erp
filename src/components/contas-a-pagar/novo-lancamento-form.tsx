'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { usePermissionsContext } from '@/lib/contexts/permissions-context'

function fmtMoney(value: number | string | null | undefined) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0))
}

type Opt = { id: string; nome?: string; codigo?: string; banco?: string }
type PlanoConta = { id: string; codigo: string; grupo: string; sintetica: string; analitica: string; natureza: string }
type Listas = {
  centros_custo: Opt[]
  contas_contabeis: { id: string; codigo: string; nome: string; centro_custo_id: string | null }[]
  empresas: Opt[]
  contas_bancarias: { id: string; banco: string; descricao: string | null }[]
  plano_contas?: PlanoConta[]
  fornecedores?: Opt[]
}

const emptyForm = {
  natureza: 'pagar' as 'pagar' | 'receber',
  tipo: 'fixo',
  fornecedor_nome: '',
  empresa_id: '',
  descricao: '',
  conta_contabil_id: '',
  plano_conta_id: '',
  centro_custo_id: '',
  valor: '',
  vencimento: '',
  reembolsavel: false,
  modo: 'nenhum',
  num_parcelas: '0',
  reajuste_data: '',
  reajuste_percentual_estim: '',
  numero_nota: '',
  forma_pagamento: '',
  conta_bancaria_id: '',
  observacoes: '',
}

type Pessoa = { user_id: string; nome: string }

const loteVazio = {
  colaborador_user_id: '',
  valor: '',
  descricao: '',
  conta_bancaria_origem_id: '',
  conta_bancaria_destino_id: '',
  data_transferencia: '',
}

export default function NovoLancamentoForm() {
  const router = useRouter()
  const { hasPermission } = usePermissionsContext()
  const canWrite = hasPermission('finance.contas_pagar.write')

  const [listas, setListas] = useState<Listas | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Edicao (pedido Filipe 11/08): o mesmo form serve para criar e para editar,
  // igual despesas ja faz. So le o ?id= sem useSearchParams, para nao precisar
  // de Suspense por causa de um link opcional.
  const [editId, setEditId] = useState<string | null>(null)
  const [editStatus, setEditStatus] = useState<string | null>(null)
  const [serie, setSerie] = useState<{ recorrenciaId: string | null; futuras: number; modo: string }>({ recorrenciaId: null, futuras: 0, modo: '' })
  const [escopoEdicao, setEscopoEdicao] = useState<'esta' | 'futuras'>('esta')
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('id')
    if (!id) return
    setEditId(id)
    void (async () => {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data, error: e } = await supabase.rpc('cp_get_lancamento', { p_user_id: user.id, p_id: id })
      if (e) { setError(e.message); return }
      const d = data as Record<string, unknown>
      setEditStatus(String(d.status || ''))
      // Quantas outras parcelas ainda da para mexer. E esse numero que decide se
      // a pergunta "esta ou todas" aparece — numa serie de uma parcela so, nao ha
      // o que perguntar.
      setSerie({
        recorrenciaId: d.recorrencia_id ? String(d.recorrencia_id) : null,
        futuras: Number(d.parcelas_futuras || 0),
        modo: String(d.serie_modo || ''),
      })
      setForm((f) => ({
        ...f,
        natureza: (d.natureza as 'pagar' | 'receber') || 'pagar',
        tipo: String(d.tipo || 'fixo'),
        fornecedor_nome: String(d.fornecedor_nome || ''),
        empresa_id: String(d.empresa_id || ''),
        descricao: String(d.descricao || ''),
        conta_contabil_id: String(d.conta_contabil_id || ''),
        plano_conta_id: String(d.plano_conta_id || ''),
        centro_custo_id: String(d.centro_custo_id || ''),
        valor: d.valor != null ? String(d.valor) : '',
        vencimento: String(d.vencimento || ''),
        reembolsavel: Boolean(d.reembolsavel),
        numero_nota: String(d.numero_nota || ''),
        forma_pagamento: String(d.forma_pagamento || ''),
        conta_bancaria_id: String(d.conta_bancaria_id || ''),
        observacoes: String(d.observacoes || ''),
      }))
    })()
  }, [])
  const [showMais, setShowMais] = useState(false)
  // Cascata do Plano de Contas: Grupo (DRE) -> Conta sintética -> Conta analítica.
  const [planoGrupo, setPlanoGrupo] = useState('')
  const [planoSintetica, setPlanoSintetica] = useState('')

  // Lote de despesas (pedido Filipe 11/08): mora aqui dentro porque o
  // adiantamento e uma saida de caixa como qualquer outra — o dinheiro sai da
  // conta na hora, mesmo que volte reembolsado la na frente.
  // Le da URL sem useSearchParams para nao precisar de Suspense so por causa
  // do atalho "+ Novo lote".
  const [modo, setModo] = useState<'conta' | 'lote'>('conta')
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('tipo') === 'lote') setModo('lote')
  }, [])
  const [lote, setLote] = useState(loteVazio)
  const [pessoas, setPessoas] = useState<Pessoa[]>([])

  const setLoteCampo = <K extends keyof typeof lote>(k: K, v: (typeof lote)[K]) =>
    setLote((l) => ({ ...l, [k]: v }))

  useEffect(() => {
    void (async () => {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data, error: e } = await supabase.rpc('cp_listas', { p_user_id: user.id })
      if (e) { setError(e.message); return }
      setListas(data as Listas)
      const { data: lista } = await supabase.rpc('get_pessoas_para_lote', { p_user_id: user.id })
      setPessoas((lista || []) as Pessoa[])
    })()
  }, [])

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }))

  // A frase que impede o engano de voltar: mostra a conta feita, com o total,
  // antes de salvar. Sem isso a ambiguidade "valor cheio" so muda de lugar.
  const previaParcelas = useMemo(() => {
    const v = Number(form.valor || 0)
    const n = Number(form.num_parcelas || 0)
    if (!v || form.modo === 'nenhum') return ''
    if (form.modo === 'parcelado') {
      if (n < 2) return 'Informe pelo menos 2 parcelas.'
      const parcela = Math.round((v / n) * 100) / 100
      const ultima = Math.round((v - parcela * (n - 1)) * 100) / 100
      const sobra = ultima !== parcela ? ` (a última fica ${fmtMoney(ultima)})` : ''
      return `${n}x de ${fmtMoney(parcela)}${sobra} — total ${fmtMoney(v)}`
    }
    if (n === 0) return `${fmtMoney(v)} todo mês, sem data para acabar`
    return `${n}x de ${fmtMoney(v)} — total ${fmtMoney(v * n)}`
  }, [form.valor, form.num_parcelas, form.modo])


  const submitLote = async () => {
    setError(null)
    if (!canWrite) { setError('Você não tem permissão para lançar.'); return }
    if (!lote.colaborador_user_id) { setError('Escolha a pessoa do lote.'); return }
    if (!lote.valor || Number(lote.valor) <= 0) { setError('Valor adiantado é obrigatório.'); return }
    if (!lote.descricao.trim()) { setError('Descrição é obrigatória.'); return }
    if (!lote.conta_bancaria_origem_id) { setError('Informe de qual conta o dinheiro saiu.'); return }

    setSaving(true)
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setError('Sessão expirada.'); return }
      const { error: e } = await supabase.rpc('criar_lote_despesa', {
        p_user_id: user.id,
        p_payload: { ...lote, valor: Number(lote.valor) },
      })
      if (e) { setError(e.message); return }
      router.push('/financeiro/contas-a-pagar')
      router.refresh()
    } catch (err) {
      console.error(err)
      setError('Erro ao criar o lote.')
    } finally {
      setSaving(false)
    }
  }

  const submit = async () => {
    setError(null)
    if (!canWrite) { setError('Você não tem permissão para lançar.'); return }
    if (!form.descricao.trim()) { setError('Descrição é obrigatória.'); return }
    if (!form.valor || Number(form.valor) <= 0) { setError('Valor é obrigatório.'); return }
    if (!form.vencimento) { setError('Vencimento é obrigatório.'); return }
    if (!editId) {
      if (!form.plano_conta_id && !form.conta_contabil_id) { setError('Escolha a conta analítica do Plano de Contas.'); return }
      if (!form.centro_custo_id) { setError('Centro de custo é obrigatório.'); return }
      if (!form.empresa_id) { setError('Empresa pagadora é obrigatória.'); return }
    }

    setSaving(true)
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setError('Sessão expirada.'); return }
      const { error: e } = editId
        ? await supabase.rpc('cp_editar_lancamento', {
            p_user_id: user.id,
            p_id: editId,
            p_payload: { ...form, valor: Number(form.valor), escopo: escopoEdicao },
          })
        : await supabase.rpc('cp_criar_lancamento', {
            p_user_id: user.id,
            p_payload: {
              ...form,
              valor: Number(form.valor),
              // O backend aceita 'modo'; 'recorrente' vai junto porque payload
              // antigo ainda e aceito e nao custa nada manter os dois de acordo.
              recorrente: form.modo !== 'nenhum',
              num_parcelas: form.modo === 'nenhum' ? null : Number(form.num_parcelas || 0),
              reajuste_percentual_estim: form.reajuste_percentual_estim ? Number(form.reajuste_percentual_estim) : null,
            },
          })
      if (e) { setError(e.message); return }
      router.push('/financeiro/contas-a-pagar')
      router.refresh()
    } catch (err) {
      console.error(err)
      setError(editId ? 'Erro ao salvar edição.' : 'Erro ao salvar lançamento.')
    } finally {
      setSaving(false)
    }
  }

  const contasFiltradas = useMemo(() => {
    if (!listas) return []
    if (!form.centro_custo_id) return listas.contas_contabeis
    return listas.contas_contabeis.filter((c) => !c.centro_custo_id || c.centro_custo_id === form.centro_custo_id)
  }, [listas, form.centro_custo_id])

  const planoContas = useMemo(() => listas?.plano_contas || [], [listas])
  const planoGrupos = useMemo(() => Array.from(new Set(planoContas.map((c) => c.grupo))), [planoContas])
  const planoSinteticas = useMemo(
    () => Array.from(new Set(planoContas.filter((c) => c.grupo === planoGrupo).map((c) => c.sintetica))),
    [planoContas, planoGrupo],
  )
  const planoAnaliticas = useMemo(
    () => planoContas.filter((c) => c.grupo === planoGrupo && c.sintetica === planoSintetica),
    [planoContas, planoGrupo, planoSintetica],
  )
  const planoSelecionado = useMemo(
    () => planoContas.find((c) => c.id === form.plano_conta_id) || null,
    [planoContas, form.plano_conta_id],
  )

  if (!canWrite) {
    return <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">Você não tem permissão para criar lançamentos.</div>
  }

  if (editId && editStatus && ['pago', 'recebido'].includes(editStatus)) {
    return (
      <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
        Este lançamento já foi baixado ({editStatus}) e não pode mais ser editado. Se foi um erro,
        peça para reverter a baixa antes de corrigir.
      </div>
    )
  }

  const inputCls = 'w-full rounded-md border border-hairline bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary'
  const labelCls = 'mb-1 block text-sm font-medium text-ink'

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      {/* Form */}
      <div className="space-y-4 lg:col-span-2 rounded-lg border border-hairline bg-white p-6">
        {error && <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}

        {/* Natureza — e o lote, que e um terceiro tipo de saida */}
        <div className="inline-flex flex-wrap rounded-md border border-hairline p-1">
          {(['pagar', 'receber'] as const).map((n) => (
            <button key={n} onClick={() => { setModo('conta'); set('natureza', n) }}
              className={`rounded px-4 py-1.5 text-sm font-medium ${modo === 'conta' && form.natureza === n ? (n === 'pagar' ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700') : 'text-ink-mute'}`}>
              Conta a {n}
            </button>
          ))}
          <button onClick={() => setModo('lote')}
            className={`rounded px-4 py-1.5 text-sm font-medium ${modo === 'lote' ? 'bg-amber-50 text-amber-700' : 'text-ink-mute'}`}>
            Lote de despesas
          </button>
        </div>

        {modo === 'lote' && (
          <>
            <p className="rounded-md border border-dashed border-amber-300 bg-amber-50/50 p-3 text-sm text-ink-secondary">
              Adiantamento para uma pessoa gastar nos casos. Sai do caixa agora, na conta que você
              informar. Depois ela lança as despesas contra esse saldo e, no fechamento, o sistema
              lança só a diferença — a sobra que ela devolve ou a falta que o escritório reembolsa.
            </p>

            <div>
              <label className={labelCls}>Pessoa</label>
              <select className={inputCls} value={lote.colaborador_user_id}
                onChange={(e) => setLoteCampo('colaborador_user_id', e.target.value)}>
                <option value="">Selecione a pessoa…</option>
                {pessoas.map((p) => <option key={p.user_id} value={p.user_id}>{p.nome}</option>)}
              </select>
            </div>

            <div>
              <label className={labelCls}>Descrição</label>
              <input className={inputCls} value={lote.descricao}
                onChange={(e) => setLoteCampo('descricao', e.target.value)}
                placeholder="Ex.: Adiantamento diligências agosto" />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Valor adiantado</label>
                <input type="number" step="0.01" className={inputCls} value={lote.valor}
                  onChange={(e) => setLoteCampo('valor', e.target.value)} placeholder="0,00" />
              </div>
              <div>
                <label className={labelCls}>Data da transferência</label>
                <input type="date" className={inputCls} value={lote.data_transferencia}
                  onChange={(e) => setLoteCampo('data_transferencia', e.target.value)} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Saiu da conta</label>
                <select className={inputCls} value={lote.conta_bancaria_origem_id}
                  onChange={(e) => setLoteCampo('conta_bancaria_origem_id', e.target.value)}>
                  <option value="">Selecione…</option>
                  {(listas?.contas_bancarias || []).map((c) => (
                    <option key={c.id} value={c.id}>{c.banco}{c.descricao ? ` — ${c.descricao}` : ''}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>Entrou na conta</label>
                <select className={inputCls} value={lote.conta_bancaria_destino_id}
                  onChange={(e) => setLoteCampo('conta_bancaria_destino_id', e.target.value)}>
                  <option value="">Não informar</option>
                  {(listas?.contas_bancarias || []).map((c) => (
                    <option key={c.id} value={c.id}>{c.banco}{c.descricao ? ` — ${c.descricao}` : ''}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button onClick={() => router.push('/financeiro/contas-a-pagar')} className="rounded-md border border-hairline px-4 py-2 text-sm hover:bg-canvas-soft">Cancelar</button>
              <button onClick={submitLote} disabled={saving} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
                {saving ? 'Criando…' : 'Criar lote'}
              </button>
            </div>
          </>
        )}

        {modo === 'conta' && (
        <>

        <div>
          <label className={labelCls}>Descrição</label>
          <input className={inputCls} value={form.descricao} onChange={(e) => set('descricao', e.target.value)} placeholder="Ex.: Aluguel — Ed. Saldanha Marinho" />
        </div>

        {form.natureza === 'pagar' && (
          <div>
            <label className={labelCls}>Fornecedor</label>
            <input
              className={inputCls}
              list="cp-fornecedores"
              value={form.fornecedor_nome}
              onChange={(e) => set('fornecedor_nome', e.target.value)}
              placeholder="Selecione ou digite o fornecedor"
              autoComplete="off"
            />
            <datalist id="cp-fornecedores">
              {(listas?.fornecedores || []).map((f) => (
                <option key={f.id} value={f.nome} />
              ))}
            </datalist>
          </div>
        )}

        {/* PLANO DE CONTAS — hierarquia da planilha: Grupo (col. B) > Sintética (col. C) > Analítica (col. D). */}
        <div className="rounded-md border border-dashed border-primary/40 bg-primary/[0.03] p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-primary">Plano de contas</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Grupo</label>
              <select
                className={inputCls}
                value={planoGrupo}
                onChange={(e) => {
                  setPlanoGrupo(e.target.value)
                  setPlanoSintetica('')
                  set('plano_conta_id', '')
                }}
              >
                <option value="">Selecione o grupo…</option>
                {planoGrupos.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Conta sintética</label>
              <select
                className={inputCls}
                value={planoSintetica}
                onChange={(e) => {
                  setPlanoSintetica(e.target.value)
                  set('plano_conta_id', '')
                }}
                disabled={!planoGrupo}
              >
                <option value="">{planoGrupo ? 'Selecione…' : 'Escolha o grupo primeiro'}</option>
                {planoSinteticas.map((sn) => <option key={sn} value={sn}>{sn}</option>)}
              </select>
            </div>
          </div>
          <div className="mt-3">
            <label className={labelCls}>Conta analítica (recebe o lançamento)</label>
            <select
              className={inputCls}
              value={form.plano_conta_id}
              onChange={(e) => set('plano_conta_id', e.target.value)}
              disabled={!planoSintetica}
            >
              <option value="">{planoSintetica ? 'Selecione…' : 'Escolha a conta sintética primeiro'}</option>
              {planoAnaliticas.map((c) => <option key={c.id} value={c.id}>{c.codigo} — {c.analitica}</option>)}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Empresa pagadora</label>
            <select className={inputCls} value={form.empresa_id} onChange={(e) => set('empresa_id', e.target.value)}>
              <option value="">Selecione…</option>
              {listas?.empresas.map((o) => <option key={o.id} value={o.id}>{o.nome}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Tipo</label>
            <select className={inputCls} value={form.tipo} onChange={(e) => set('tipo', e.target.value)}>
              <option value="fixo">Fixo</option>
              <option value="variavel">Variável</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Centro de custo</label>
            <select className={inputCls} value={form.centro_custo_id} onChange={(e) => set('centro_custo_id', e.target.value)}>
              <option value="">Selecione…</option>
              {listas?.centros_custo.map((o) => <option key={o.id} value={o.id}>{o.nome}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Conta contábil</label>
            {planoSelecionado ? (
              <input className={`${inputCls} bg-canvas-soft text-ink-mute`} readOnly value={`${planoSelecionado.codigo} — ${planoSelecionado.analitica}`} title="Preenchida pela conta analítica" />
            ) : (
              <select className={inputCls} value={form.conta_contabil_id} onChange={(e) => set('conta_contabil_id', e.target.value)}>
                <option value="">Preenchida pela conta analítica…</option>
                {contasFiltradas.map((c) => <option key={c.id} value={c.id}>{c.codigo} — {c.nome}</option>)}
              </select>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Valor</label>
            <input type="number" step="0.01" min="0" className={inputCls} value={form.valor} onChange={(e) => set('valor', e.target.value)} placeholder="0,00" />
          </div>
          <div>
            <label className={labelCls}>Vencimento</label>
            <input type="date" className={inputCls} value={form.vencimento} onChange={(e) => set('vencimento', e.target.value)} />
          </div>
        </div>

        {/*
          Editando uma parcela de série: até 25/08 mexer aqui alterava SÓ este mês
          e as futuras continuavam com o valor velho, caladas. Agora pergunta —
          mas o padrão continua sendo "só esta", que é o comportamento que já
          existia e o que ele temia perder ("as outras não se movem").
        */}
        {editId && serie.recorrenciaId && serie.futuras > 0 && (
          <div className="rounded-md border border-primary/40 bg-primary-soft-bg/40 p-3">
            <span className="block text-sm font-medium text-ink">
              {serie.modo === 'parcelado' ? 'Esta é uma parcela' : 'Esta é uma despesa recorrente'}
            </span>
            <span className="block text-xs text-ink-mute">
              Há mais {serie.futuras} {serie.futuras === 1 ? 'parcela futura' : 'parcelas futuras'} não pagas. O que você quer alterar?
            </span>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {[
                { v: 'esta' as const, t: 'Só esta', d: 'As outras ficam como estão' },
                { v: 'futuras' as const, t: `Esta e as ${serie.futuras} futuras`, d: 'Valor e classificação; a data de cada uma é mantida' },
              ].map((op) => (
                <button
                  key={op.v}
                  type="button"
                  onClick={() => setEscopoEdicao(op.v)}
                  className={`rounded-md border p-2 text-left transition ${
                    escopoEdicao === op.v ? 'border-primary bg-primary-soft-bg' : 'border-hairline hover:bg-canvas-soft'
                  }`}
                >
                  <span className="block text-sm font-medium text-ink">{op.t}</span>
                  <span className="block text-xs text-ink-mute">{op.d}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/*
          Antes era um checkbox só, "Despesa recorrente", e o campo de parcelas
          REPETIA o valor: R$ 12.210 em "3 parcelas" criava três de R$ 12.210.
          Quem esperava divisão inflava a projeção de saída em 3x sem perceber.
          Agora são dois modos com nome próprio, e o resumo abaixo mostra a conta
          antes de salvar — é ele que impede o engano de voltar.
        */}
        <div className={`rounded-md border border-hairline p-3 ${editId ? 'hidden' : ''}`}>
          <span className="block text-sm font-medium text-ink">Repete ou parcela?</span>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            {[
              { v: 'nenhum', t: 'Não repete', d: 'Um lançamento só' },
              { v: 'recorrente', t: 'Recorrente', d: 'Repete todo mês, sem fim' },
              { v: 'parcelado', t: 'Parcelado', d: 'Divide um total em N vezes' },
            ].map((op) => (
              <button
                key={op.v}
                type="button"
                onClick={() => set('modo', op.v)}
                className={`rounded-md border p-2 text-left transition ${
                  form.modo === op.v
                    ? 'border-primary bg-primary-soft-bg'
                    : 'border-hairline hover:bg-canvas-soft'
                }`}
              >
                <span className="block text-sm font-medium text-ink">{op.t}</span>
                <span className="block text-xs text-ink-mute">{op.d}</span>
              </button>
            ))}
          </div>

          {form.modo === 'recorrente' && (
            <div className="mt-3">
              <label className={labelCls}>Quantas vezes? (0 = sem prazo, até cancelar)</label>
              <input type="number" min="0" className={inputCls} value={form.num_parcelas}
                onChange={(e) => set('num_parcelas', e.target.value)} />
              <p className="mt-1 text-xs text-ink-mute">
                O valor digitado é o de <b>cada mês</b> e se repete igual.
              </p>
            </div>
          )}

          {form.modo === 'parcelado' && (
            <div className="mt-3">
              <label className={labelCls}>Em quantas parcelas?</label>
              <input type="number" min="2" className={inputCls} value={form.num_parcelas}
                onChange={(e) => set('num_parcelas', e.target.value)} />
              <p className="mt-1 text-xs text-ink-mute">
                O valor digitado é o <b>total</b>, e o sistema divide.
              </p>
            </div>
          )}

          {previaParcelas && (
            <p className="mt-2 rounded bg-canvas-soft px-2 py-1.5 text-sm text-ink">
              {previaParcelas}
            </p>
          )}
        </div>

        {form.natureza === 'pagar' && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.reembolsavel} onChange={(e) => set('reembolsavel', e.target.checked)} />
            <span>Reembolsável <span className="text-ink-mute">(gera uma previsão de entrada vinculada)</span></span>
          </label>
        )}

        {/* Mais opções */}
        <button onClick={() => setShowMais((v) => !v)} className="text-sm text-primary hover:underline">
          {showMais ? '− Menos opções' : '+ Mais opções (reajuste, pagamento, nota, anexo)'}
        </button>
        {showMais && (
          <div className="space-y-4 rounded-md border border-dashed border-hairline p-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Reajuste — data</label>
                <input type="date" className={inputCls} value={form.reajuste_data} onChange={(e) => set('reajuste_data', e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>Reajuste — % IPCA estimado</label>
                <input type="number" step="0.01" className={inputCls} value={form.reajuste_percentual_estim} onChange={(e) => set('reajuste_percentual_estim', e.target.value)} placeholder="ex.: 4.50" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Forma de pagamento</label>
                <input className={inputCls} value={form.forma_pagamento} onChange={(e) => set('forma_pagamento', e.target.value)} placeholder="Boleto, Pix, TED…" />
              </div>
              <div>
                <label className={labelCls}>Conta bancária (saída)</label>
                <select className={inputCls} value={form.conta_bancaria_id} onChange={(e) => set('conta_bancaria_id', e.target.value)}>
                  <option value="">Selecione…</option>
                  {listas?.contas_bancarias.map((c) => <option key={c.id} value={c.id}>{c.banco}{c.descricao ? ` — ${c.descricao}` : ''}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className={labelCls}>Número da nota</label>
              <input className={inputCls} value={form.numero_nota} onChange={(e) => set('numero_nota', e.target.value)} />
            </div>
          </div>
        )}

        <div>
          <label className={labelCls}>Observações</label>
          <textarea rows={3} className={inputCls} value={form.observacoes} onChange={(e) => set('observacoes', e.target.value)} placeholder="Notas internas, condições de pagamento…" />
        </div>

        <div className="flex justify-end gap-2">
          <button onClick={() => router.push('/financeiro/contas-a-pagar')} className="rounded-md border border-hairline px-4 py-2 text-sm hover:bg-canvas-soft">Cancelar</button>
          <button onClick={submit} disabled={saving} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
            {saving ? 'Salvando…' : editId ? 'Salvar edição' : 'Salvar lançamento'}
          </button>
        </div>
        </>
        )}
      </div>

      {/* Pré-visualização */}
      <div>
        <p className="mb-2 text-xs uppercase tracking-wide text-ink-mute">Pré-visualização</p>
        <div className="rounded-lg border border-hairline bg-white p-5">
          <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${modo === 'lote' ? 'bg-amber-50 text-amber-700' : form.natureza === 'pagar' ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
            {modo === 'lote' ? 'LOTE — SAÍDA DE CAIXA' : form.natureza === 'pagar' ? 'A PAGAR' : 'A RECEBER'}
          </span>
          <p className="mt-3 text-3xl font-semibold text-ink">{fmtMoney(modo === 'lote' ? lote.valor : form.valor)}</p>
          <p className="text-sm text-ink-mute">{(modo === 'lote' ? lote.descricao : form.descricao) || '—'}</p>
          {modo === 'lote' ? (
            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-ink-mute">Pessoa</dt><dd className="truncate pl-2 text-right">{pessoas.find((p) => p.user_id === lote.colaborador_user_id)?.nome || '—'}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-mute">Saiu da conta</dt><dd className="truncate pl-2 text-right">{listas?.contas_bancarias.find((c) => c.id === lote.conta_bancaria_origem_id)?.banco || '—'}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-mute">Entrou na conta</dt><dd className="truncate pl-2 text-right">{listas?.contas_bancarias.find((c) => c.id === lote.conta_bancaria_destino_id)?.banco || '—'}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-mute">Data</dt><dd>{lote.data_transferencia ? lote.data_transferencia.split('-').reverse().join('/') : 'hoje'}</dd></div>
            </dl>
          ) : (
          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-ink-mute">Vencimento</dt><dd>{form.vencimento ? form.vencimento.split('-').reverse().join('/') : '—'}</dd></div>
            <div className="flex justify-between"><dt className="text-ink-mute">Centro de custo</dt><dd>{listas?.centros_custo.find((c) => c.id === form.centro_custo_id)?.nome || '—'}</dd></div>
            <div className="flex justify-between"><dt className="text-ink-mute">Conta contábil</dt><dd>{listas?.contas_contabeis.find((c) => c.id === form.conta_contabil_id)?.codigo || '—'}</dd></div>
            <div className="flex justify-between"><dt className="text-ink-mute">Empresa</dt><dd>{listas?.empresas.find((e) => e.id === form.empresa_id)?.nome || '—'}</dd></div>
            {form.modo !== 'nenhum' && <div className="flex justify-between"><dt className="text-ink-mute">{form.modo === 'parcelado' ? 'Parcelado' : 'Recorrência'}</dt><dd>{form.modo === 'parcelado' ? `${form.num_parcelas}x de ${fmtMoney(Number(form.valor || 0) / Math.max(Number(form.num_parcelas) || 1, 1))}` : (Number(form.num_parcelas) === 0 ? 'sem prazo' : `${form.num_parcelas}x`)}</dd></div>}
            {form.reembolsavel && <div className="flex justify-between"><dt className="text-ink-mute">Reembolsável</dt><dd>sim → gera entrada</dd></div>}
          </dl>
          )}
        </div>
      </div>
    </div>
  )
}
