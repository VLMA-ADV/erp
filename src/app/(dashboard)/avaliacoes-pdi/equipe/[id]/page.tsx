'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { Save, Send, CheckCircle2, TrendingUp } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'

interface Faixa { codigo: string; rotulo: string; ordem: number }
interface Skill { id: string; trilha: string; pilar_numero: number; pilar_nome: string; item_codigo: string; titulo: string | null; nome: string; descricao: string | null; faixa_auto: string | null; texto_auto: string | null; faixa_final: string | null; texto_final: string | null }
interface Dna { id: string; numero: number; nome: string; texto_auto: string | null }
interface Meta { id: string; nome: string | null; descricao: string | null; indicadores: string | null; semestre: number | null; progresso_pct: number | null; faixa_auto: string | null; faixa_final: string | null; validada: boolean }
interface Cargo { id: string; nome: string; codigo: string; nivel: number | null; salario_sugerido: number | null }
interface Avaliacao {
  id: string; ano: number; status: string; faixa_final_geral: string | null; resultado: string | null; parecer_gestor: string | null
  autoavaliacao_enviada_at: string | null; avaliacao_gestor_enviada_at: string | null; progressao_aplicada_at: string | null
  gestor_nome: string | null; salario_anterior: number | null; novo_salario: number | null; novo_cargo_id: string | null
  bonus_pdi: boolean | null; bonus_performance_plus: number | null; bonus_comercial: number | null
  cargo_nome_snapshot: string | null; nivel_codigo_snapshot: string | null; carreira_codigo: string | null; adicional_snapshot: string | null; area_nome_snapshot: string | null
  colaborador_nome: string | null; salario_atual: number | null; cargo_atual_id: string | null
}

const TRILHA_LABEL: Record<string, string> = { base: 'Skills da carreira', lideranca: 'Adicional — Liderança', estrategico: 'Adicional — Estratégico' }
const RESULTADOS = [
  { v: 'mantem_faixa_atual', l: 'Mantém faixa atual' },
  { v: 'progressao_simples', l: 'Progressão simples' },
  { v: 'progressao_diferenciada', l: 'Progressão diferenciada' },
]

function faixaColor(codigo: string | null, active: boolean): string {
  const base = active ? 'text-white' : 'bg-card text-ink-secondary'
  if (!active) return 'border-hairline ' + base
  switch (codigo) {
    case 'baixa_performance': return 'bg-red-600 border-red-600 ' + base
    case 'a_melhorar': return 'bg-amber-500 border-amber-500 ' + base
    case 'dentro_da_media': return 'bg-ink border-ink ' + base
    case 'acima_do_esperado': return 'bg-primary border-primary text-primary-foreground'
    case 'fora_da_curva': return 'bg-emerald-600 border-emerald-600 ' + base
    default: return 'bg-ink border-ink ' + base
  }
}

const brl = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }))

export default function ReviewPdiPage() {
  const params = useParams<{ id: string }>()
  const id = params?.id

  const [aval, setAval] = useState<Avaliacao | null>(null)
  const [regua, setRegua] = useState<Faixa[]>([])
  const [skills, setSkills] = useState<Skill[]>([])
  const [dna, setDna] = useState<Dna[]>([])
  const [metas, setMetas] = useState<Meta[]>([])
  const [cargos, setCargos] = useState<Cargo[]>([])
  const [faixaGeral, setFaixaGeral] = useState<string>('')
  const [resultado, setResultado] = useState<string>('')
  const [parecer, setParecer] = useState<string>('')
  const [bonusPdi, setBonusPdi] = useState(false)
  const [bonusPlus, setBonusPlus] = useState<string>('')
  const [bonusComercial, setBonusComercial] = useState<string>('')
  const [novoCargo, setNovoCargo] = useState<string>('')
  const [novoSalario, setNovoSalario] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!id) return
    try {
      setLoading(true); setError(null)
      const supabase = createClient()
      const { data, error: err } = await supabase.rpc('get_avaliacao_pdi_gestor', { p_avaliacao_id: id })
      if (err) { setError(err.message); return }
      const d = data as { avaliacao: Avaliacao; regua: Faixa[]; skills: Skill[]; dna: Dna[]; metas: Meta[]; cargos: Cargo[] }
      setAval(d.avaliacao); setRegua(d.regua || []); setSkills(d.skills || []); setDna(d.dna || []); setMetas(d.metas || []); setCargos(d.cargos || [])
      setFaixaGeral(d.avaliacao?.faixa_final_geral || '')
      setResultado(d.avaliacao?.resultado || '')
      setParecer(d.avaliacao?.parecer_gestor || '')
      setBonusPdi(!!d.avaliacao?.bonus_pdi)
      setBonusPlus(d.avaliacao?.bonus_performance_plus != null ? String(d.avaliacao.bonus_performance_plus) : '')
      setBonusComercial(d.avaliacao?.bonus_comercial != null ? String(d.avaliacao.bonus_comercial) : '')
      setNovoCargo(d.avaliacao?.novo_cargo_id || d.avaliacao?.cargo_atual_id || '')
      setNovoSalario(d.avaliacao?.novo_salario != null ? String(d.avaliacao.novo_salario) : (d.avaliacao?.salario_atual != null ? String(d.avaliacao.salario_atual) : ''))
    } catch (e) { setError((e as Error).message) } finally { setLoading(false) }
  }, [id])

  useEffect(() => { void load() }, [load])

  const setSkill = (sid: string, patch: Partial<Skill>) => setSkills((prev) => prev.map((s) => s.id === sid ? { ...s, ...patch } : s))
  const setMeta = (mid: string, patch: Partial<Meta>) => setMetas((prev) => prev.map((m) => m.id === mid ? { ...m, ...patch } : m))

  const skillsPorTrilha = useMemo(() => {
    const g: Record<string, Record<number, Skill[]>> = {}
    for (const s of skills) { (g[s.trilha] ||= {})[s.pilar_numero] ||= []; g[s.trilha][s.pilar_numero].push(s) }
    return g
  }, [skills])

  const aplicada = !!aval?.progressao_aplicada_at

  const save = async (enviar: boolean) => {
    if (enviar && !window.confirm('Concluir a avaliação do gestor? A faixa final e o resultado ficam registrados.')) return
    try {
      setSaving(true); setError(null); setMsg(null)
      const supabase = createClient()
      const { error: err } = await supabase.rpc('salvar_avaliacao_gestor', {
        p_avaliacao_id: id,
        p_skills: skills.map((s) => ({ id: s.id, faixa_final: s.faixa_final, texto_final: s.texto_final })),
        p_metas: metas.map((m) => ({ id: m.id, faixa_final: m.faixa_final, validada: m.validada })),
        p_faixa_final_geral: faixaGeral || null,
        p_resultado: resultado || null,
        p_parecer: parecer || null,
        p_bonus_pdi: bonusPdi,
        p_bonus_performance_plus: bonusPlus ? Number(bonusPlus) : null,
        p_bonus_comercial: bonusComercial ? Number(bonusComercial) : null,
        p_enviar: enviar,
      })
      if (err) { setError(err.message); return }
      setMsg(enviar ? 'Avaliação concluída.' : 'Rascunho salvo.')
      await load()
    } catch (e) { setError((e as Error).message) } finally { setSaving(false) }
  }

  const aplicarProgressao = async () => {
    if (!window.confirm('Aplicar a progressão? Isso atualiza o cargo e o salário no cadastro do colaborador.')) return
    try {
      setApplying(true); setError(null); setMsg(null)
      const supabase = createClient()
      const { error: err } = await supabase.rpc('aplicar_progressao_pdi', {
        p_avaliacao_id: id,
        p_novo_cargo_id: novoCargo || null,
        p_novo_salario: novoSalario ? Number(novoSalario) : null,
      })
      if (err) { setError(err.message); return }
      setMsg('Progressão aplicada no cadastro.')
      await load()
    } catch (e) { setError((e as Error).message) } finally { setApplying(false) }
  }

  function GestorPicker({ value, onChange }: { value: string | null; onChange: (v: string) => void }) {
    return (
      <div className="flex flex-wrap gap-1">
        {regua.map((f) => (
          <button key={f.codigo} type="button" onClick={() => onChange(f.codigo)}
            className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition hover:border-primary ${faixaColor(f.codigo, value === f.codigo)}`}>
            {f.rotulo}
          </button>
        ))}
      </div>
    )
  }

  function AutoBadge({ codigo }: { codigo: string | null }) {
    if (!codigo) return <span className="text-xs text-ink-mute">— sem autoavaliação</span>
    const f = regua.find((r) => r.codigo === codigo)
    return <span className={`inline-block rounded-full border px-2.5 py-1 text-[11px] font-medium ${faixaColor(codigo, true)}`}>{f?.rotulo || codigo}</span>
  }

  if (loading) return <div className="container mx-auto px-6 py-12"><p className="text-sm text-ink-mute">Carregando avaliação…</p></div>
  if (error && !aval) return <div className="container mx-auto px-6 py-12"><p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p></div>

  return (
    <div className="container mx-auto max-w-4xl px-6 py-10 pb-28">
      <header className="mb-6">
        <span className="text-eyebrow">PESSOAS · PDI {aval?.ano} · GESTOR</span>
        <h1 className="mt-2 display-lg text-ink">{aval?.colaborador_nome}</h1>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <span className="rounded-full border border-hairline bg-card px-2.5 py-1 text-ink-secondary">{aval?.cargo_nome_snapshot}</span>
          {aval?.area_nome_snapshot ? <span className="rounded-full border border-hairline bg-card px-2.5 py-1 text-ink-secondary">{aval.area_nome_snapshot}</span> : null}
          {aval?.adicional_snapshot ? <span className="rounded-full bg-primary-soft-bg px-2.5 py-1 font-medium text-primary-soft-fg">Adicional: {aval.adicional_snapshot}</span> : null}
          {aplicada ? <span className="rounded-full bg-emerald-50 px-2.5 py-1 font-medium text-emerald-700">Progressão aplicada</span> : null}
        </div>
        <Link href="/avaliacoes-pdi/equipe" className="mt-3 inline-block text-sm text-primary underline underline-offset-2">← Avaliações da equipe</Link>
      </header>

      {!aval?.autoavaliacao_enviada_at ? <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">O colaborador ainda não enviou a autoavaliação. Você pode registrar a sua mesmo assim.</p> : null}

      {/* SKILLS lado a lado */}
      {Object.keys(skillsPorTrilha).sort((a, b) => (a === 'base' ? -1 : 1)).map((trilha) => (
        <section key={trilha} className="mb-8">
          <h2 className="display-md mb-3 text-ink">{TRILHA_LABEL[trilha] || trilha}</h2>
          <div className="space-y-4">
            {Object.keys(skillsPorTrilha[trilha]).map(Number).sort((a, b) => a - b).map((pil) => {
              const items = skillsPorTrilha[trilha][pil]
              return (
                <div key={pil} className="overflow-hidden rounded-xl border border-hairline bg-card">
                  <div className="border-b border-hairline bg-canvas-soft px-4 py-2 text-sm font-semibold text-ink">{pil}. {items[0]?.pilar_nome}</div>
                  <div className="divide-y divide-hairline">
                    {items.map((s) => (
                      <div key={s.id} className="p-4">
                        <div className="mb-2">
                          <span className="text-sm font-medium text-ink">{s.titulo || s.nome}</span>
                          {s.descricao ? <p className="mt-0.5 text-xs text-ink-mute"><span className="font-tabular">{s.item_codigo}</span> {s.descricao}</p> : null}
                        </div>
                        <div className="grid gap-3 md:grid-cols-2">
                          <div className="rounded-lg border border-hairline bg-canvas-soft/50 p-3">
                            <p className="text-eyebrow mb-1.5">Autoavaliação</p>
                            <AutoBadge codigo={s.faixa_auto} />
                            {s.texto_auto ? <p className="mt-1.5 whitespace-pre-wrap text-xs text-ink-secondary">{s.texto_auto}</p> : null}
                          </div>
                          <div className="rounded-lg border border-brand-purple/25 bg-brand-purple-soft/40 p-3">
                            <p className="text-eyebrow mb-1.5">Sua avaliação</p>
                            <GestorPicker value={s.faixa_final} onChange={(v) => setSkill(s.id, { faixa_final: v })} />
                            <textarea value={s.texto_final || ''} onChange={(e) => setSkill(s.id, { texto_final: e.target.value })}
                              placeholder="Comentário do gestor…" rows={2}
                              className="mt-2 w-full resize-none rounded-md border border-hairline-input bg-background px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-ring" />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      ))}

      {/* METAS */}
      <section className="mb-8">
        <h2 className="display-md mb-1 text-ink">Metas do PDI</h2>
        <p className="mb-3 text-sm text-ink-mute">Valide cada meta (alinhamento com a estratégia) e atribua a faixa de entrega.</p>
        {metas.length === 0 ? <p className="rounded-xl border border-dashed border-hairline bg-canvas-soft p-4 text-sm text-ink-mute">Nenhuma meta cadastrada pelo colaborador.</p> : null}
        <div className="space-y-3">
          {metas.map((m) => (
            <div key={m.id} className="rounded-xl border border-hairline bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">{m.semestre ? `${m.semestre}º sem · ` : ''}{m.nome || 'Meta'}</p>
                  {m.descricao ? <p className="mt-0.5 whitespace-pre-wrap text-xs text-ink-secondary">{m.descricao}</p> : null}
                  {m.indicadores ? <p className="mt-1 whitespace-pre-wrap text-xs text-ink-mute">Indicadores: {m.indicadores}</p> : null}
                  <p className="mt-1 text-xs text-ink-mute">Progresso informado: <span className="font-tabular">{m.progresso_pct ?? 0}%</span></p>
                </div>
                <label className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-ink-secondary">
                  <input type="checkbox" checked={m.validada} onChange={(e) => setMeta(m.id, { validada: e.target.checked })} /> Validada
                </label>
              </div>
              <div className="mt-2 rounded-lg border border-brand-purple/25 bg-brand-purple-soft/40 p-2">
                <p className="text-eyebrow mb-1.5">Faixa de entrega</p>
                <GestorPicker value={m.faixa_final} onChange={(v) => setMeta(m.id, { faixa_final: v })} />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* DNA (leitura) */}
      {dna.length > 0 ? (
        <section className="mb-8">
          <h2 className="display-md mb-1 text-ink">DNA VLMA</h2>
          <p className="mb-3 text-sm text-ink-mute">Alinhamento cultural — não pontua.</p>
          <div className="space-y-2">
            {dna.map((d) => (
              <div key={d.id} className="rounded-xl border border-hairline bg-card p-3">
                <div className="text-sm font-medium text-ink"><span className="font-tabular text-primary">{d.numero}.</span> {d.nome}</div>
                {d.texto_auto ? <p className="mt-1 whitespace-pre-wrap text-xs text-ink-secondary">{d.texto_auto}</p> : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* RESULTADO GERAL */}
      <section className="mb-8 rounded-xl border border-hairline bg-card p-5">
        <h2 className="display-md mb-3 text-ink">Resultado geral</h2>
        <p className="text-eyebrow mb-1.5">Faixa final geral</p>
        <GestorPicker value={faixaGeral} onChange={setFaixaGeral} />
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div>
            <p className="text-eyebrow mb-1.5">Resultado</p>
            <select value={resultado} onChange={(e) => setResultado(e.target.value)}
              className="h-9 w-full rounded-md border border-hairline-input bg-background px-2 text-sm text-ink">
              <option value="">Selecione…</option>
              {RESULTADOS.map((r) => <option key={r.v} value={r.v}>{r.l}</option>)}
            </select>
          </div>
          <div>
            <p className="text-eyebrow mb-1.5">Bônus</p>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-1.5 text-sm text-ink-secondary">
                <input type="checkbox" checked={bonusPdi} onChange={(e) => setBonusPdi(e.target.checked)} /> Bônus PDI
              </label>
              <input value={bonusPlus} onChange={(e) => setBonusPlus(e.target.value)} inputMode="decimal" placeholder="PLR Plus (R$)"
                className="h-9 w-32 rounded-md border border-hairline-input bg-background px-2 text-sm text-ink" />
              <input value={bonusComercial} onChange={(e) => setBonusComercial(e.target.value)} inputMode="decimal" placeholder="Comercial (R$)"
                className="h-9 w-32 rounded-md border border-hairline-input bg-background px-2 text-sm text-ink" />
            </div>
          </div>
        </div>
        <p className="text-eyebrow mb-1.5 mt-4">Parecer do gestor</p>
        <textarea value={parecer} onChange={(e) => setParecer(e.target.value)} rows={3} placeholder="Síntese da avaliação, pontos fortes e de desenvolvimento…"
          className="w-full resize-none rounded-md border border-hairline-input bg-background px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-ring" />
      </section>

      {/* PROGRESSÃO */}
      <section className="mb-8 rounded-xl border border-brand-purple/25 bg-brand-purple-soft/50 p-5">
        <div className="mb-3 flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-brand-purple-fg" />
          <h2 className="display-md text-ink">Progressão de cargo e salário</h2>
        </div>
        {aplicada ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
            <p className="flex items-center gap-2 font-medium"><CheckCircle2 className="h-4 w-4" /> Progressão aplicada no cadastro.</p>
            <p className="mt-1">Salário: {brl(aval?.salario_anterior)} → <span className="font-medium">{brl(aval?.novo_salario)}</span></p>
          </div>
        ) : (
          <>
            <p className="mb-3 text-sm text-ink-secondary">Cargo atual: <span className="font-medium text-ink">{aval?.cargo_nome_snapshot || '—'}</span> · Salário atual: <span className="font-medium text-ink">{brl(aval?.salario_atual)}</span></p>
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <p className="text-eyebrow mb-1.5">Novo cargo</p>
                <select value={novoCargo} onChange={(e) => {
                    const cid = e.target.value
                    setNovoCargo(cid)
                    const sug = cargos.find((c) => c.id === cid)?.salario_sugerido
                    if (sug != null) setNovoSalario(String(sug))
                  }}
                  className="h-9 w-full rounded-md border border-hairline-input bg-background px-2 text-sm text-ink">
                  <option value="">Manter cargo atual</option>
                  {cargos.map((c) => <option key={c.id} value={c.id}>{c.nome}{c.salario_sugerido != null ? ` — ${brl(c.salario_sugerido)}` : ''}</option>)}
                </select>
                <p className="mt-1 text-xs text-ink-mute">Salário sugerido do quadro preenche o campo ao lado; você pode ajustar.</p>
              </div>
              <div>
                <p className="text-eyebrow mb-1.5">Novo salário (R$)</p>
                <input value={novoSalario} onChange={(e) => setNovoSalario(e.target.value)} inputMode="decimal" placeholder="Manter salário atual"
                  className="h-9 w-full rounded-md border border-hairline-input bg-background px-2 text-sm text-ink" />
              </div>
            </div>
            <Button onClick={() => void aplicarProgressao()} disabled={applying} className="mt-4 bg-brand-purple text-white hover:opacity-90">
              <TrendingUp className="mr-1 h-4 w-4" /> Aplicar progressão
            </Button>
          </>
        )}
      </section>

      {/* SAVE BAR */}
      <div className="fixed inset-x-0 bottom-0 border-t border-hairline bg-card/95 backdrop-blur">
        <div className="container mx-auto flex max-w-4xl items-center justify-between gap-3 px-6 py-3">
          <span className="text-sm text-ink-mute">{msg || error || 'Salve o rascunho ou conclua a avaliação.'}</span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => void save(false)} disabled={saving}><Save className="mr-1 h-4 w-4" /> Salvar rascunho</Button>
            <Button onClick={() => void save(true)} disabled={saving}><Send className="mr-1 h-4 w-4" /> Concluir avaliação</Button>
          </div>
        </div>
      </div>
    </div>
  )
}
