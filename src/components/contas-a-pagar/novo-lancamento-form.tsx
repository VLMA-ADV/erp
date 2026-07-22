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
  recorrente: false,
  num_parcelas: '0',
  reajuste_data: '',
  reajuste_percentual_estim: '',
  numero_nota: '',
  forma_pagamento: '',
  conta_bancaria_id: '',
  observacoes: '',
}

export default function NovoLancamentoForm() {
  const router = useRouter()
  const { hasPermission } = usePermissionsContext()
  const canWrite = hasPermission('finance.contas_pagar.write')

  const [listas, setListas] = useState<Listas | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showMais, setShowMais] = useState(false)
  // Cascata do Plano de Contas: Grupo (DRE) -> Conta sintética -> Conta analítica.
  const [planoGrupo, setPlanoGrupo] = useState('')
  const [planoSintetica, setPlanoSintetica] = useState('')

  useEffect(() => {
    void (async () => {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data, error: e } = await supabase.rpc('cp_listas', { p_user_id: user.id })
      if (e) { setError(e.message); return }
      setListas(data as Listas)
    })()
  }, [])

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }))

  const submit = async () => {
    setError(null)
    if (!canWrite) { setError('Você não tem permissão para lançar.'); return }
    if (!form.descricao.trim()) { setError('Descrição é obrigatória.'); return }
    if (!form.valor || Number(form.valor) <= 0) { setError('Valor é obrigatório.'); return }
    if (!form.vencimento) { setError('Vencimento é obrigatório.'); return }
    if (!form.plano_conta_id && !form.conta_contabil_id) { setError('Escolha a conta analítica do Plano de Contas.'); return }
    if (!form.centro_custo_id) { setError('Centro de custo é obrigatório.'); return }
    if (!form.empresa_id) { setError('Empresa pagadora é obrigatória.'); return }

    setSaving(true)
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setError('Sessão expirada.'); return }
      const { error: e } = await supabase.rpc('cp_criar_lancamento', {
        p_user_id: user.id,
        p_payload: {
          ...form,
          valor: Number(form.valor),
          num_parcelas: form.recorrente ? Number(form.num_parcelas || 0) : null,
          reajuste_percentual_estim: form.reajuste_percentual_estim ? Number(form.reajuste_percentual_estim) : null,
        },
      })
      if (e) { setError(e.message); return }
      router.push('/financeiro/contas-a-pagar')
      router.refresh()
    } catch (err) {
      console.error(err)
      setError('Erro ao salvar lançamento.')
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

  const inputCls = 'w-full rounded-md border border-hairline bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary'
  const labelCls = 'mb-1 block text-sm font-medium text-ink'

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      {/* Form */}
      <div className="space-y-4 lg:col-span-2 rounded-lg border border-hairline bg-white p-6">
        {error && <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}

        {/* Natureza */}
        <div className="inline-flex rounded-md border border-hairline p-1">
          {(['pagar', 'receber'] as const).map((n) => (
            <button key={n} onClick={() => set('natureza', n)}
              className={`rounded px-4 py-1.5 text-sm font-medium ${form.natureza === n ? (n === 'pagar' ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700') : 'text-ink-mute'}`}>
              Conta a {n}
            </button>
          ))}
        </div>

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

        {/* Recorrência */}
        <div className="rounded-md border border-hairline p-3">
          <label className="flex items-center justify-between">
            <span>
              <span className="block text-sm font-medium text-ink">Despesa recorrente</span>
              <span className="block text-xs text-ink-mute">Gera lançamentos automáticos nos próximos meses.</span>
            </span>
            <input type="checkbox" checked={form.recorrente} onChange={(e) => set('recorrente', e.target.checked)} />
          </label>
          {form.recorrente && (
            <div className="mt-3">
              <label className={labelCls}>Quantas parcelas? (0 = sem prazo, até cancelar)</label>
              <input type="number" min="0" className={inputCls} value={form.num_parcelas} onChange={(e) => set('num_parcelas', e.target.value)} />
            </div>
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
            {saving ? 'Salvando…' : 'Salvar lançamento'}
          </button>
        </div>
      </div>

      {/* Pré-visualização */}
      <div>
        <p className="mb-2 text-xs uppercase tracking-wide text-ink-mute">Pré-visualização</p>
        <div className="rounded-lg border border-hairline bg-white p-5">
          <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${form.natureza === 'pagar' ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
            {form.natureza === 'pagar' ? 'A PAGAR' : 'A RECEBER'}
          </span>
          <p className="mt-3 text-3xl font-semibold text-ink">{fmtMoney(form.valor)}</p>
          <p className="text-sm text-ink-mute">{form.descricao || '—'}</p>
          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-ink-mute">Vencimento</dt><dd>{form.vencimento ? form.vencimento.split('-').reverse().join('/') : '—'}</dd></div>
            <div className="flex justify-between"><dt className="text-ink-mute">Centro de custo</dt><dd>{listas?.centros_custo.find((c) => c.id === form.centro_custo_id)?.nome || '—'}</dd></div>
            <div className="flex justify-between"><dt className="text-ink-mute">Conta contábil</dt><dd>{listas?.contas_contabeis.find((c) => c.id === form.conta_contabil_id)?.codigo || '—'}</dd></div>
            <div className="flex justify-between"><dt className="text-ink-mute">Empresa</dt><dd>{listas?.empresas.find((e) => e.id === form.empresa_id)?.nome || '—'}</dd></div>
            {form.recorrente && <div className="flex justify-between"><dt className="text-ink-mute">Recorrência</dt><dd>{Number(form.num_parcelas) === 0 ? 'sem prazo' : `${form.num_parcelas}x`}</dd></div>}
            {form.reembolsavel && <div className="flex justify-between"><dt className="text-ink-mute">Reembolsável</dt><dd>sim → gera entrada</dd></div>}
          </dl>
        </div>
      </div>
    </div>
  )
}
