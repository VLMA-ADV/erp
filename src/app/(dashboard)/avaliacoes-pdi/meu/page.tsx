'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Plus, Trash2, Save, Send, ChevronDown, ChevronRight } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'

interface Faixa { codigo: string; rotulo: string; ordem: number; reflexo: string }
interface Skill { id: string; trilha: string; pilar_numero: number; pilar_nome: string; item_codigo: string; titulo: string | null; nome: string; descricao: string | null; faixa_auto: string | null; texto_auto: string | null }
interface Dna { id: string; numero: number; nome: string; faixa_auto: string | null; texto_auto: string | null }
interface Meta { id: string; nome: string | null; descricao: string | null; indicadores: string | null; semestre: number | null; progresso_pct: number | null; _new?: boolean }
interface Feedback { id: string; mes: number; realizado: boolean; funcionou: string | null; nao_funcionou: string | null; onde_focar: string | null; persiste: string | null }
interface Avaliacao { id: string; ano: number; status: string; bloqueada: boolean; cargo_nome_snapshot: string | null; nivel_codigo_snapshot: string | null; carreira_codigo: string | null; adicional_snapshot: string | null; area_nome_snapshot: string | null; colaborador_nome: string | null }

const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
const TRILHA_LABEL: Record<string, string> = { base: 'Skills da carreira', lideranca: 'Adicional — Liderança', estrategico: 'Adicional — Estratégico' }
const ANO = 2026

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

function tempId() { return 'new-' + Math.random().toString(36).slice(2) }

export default function MeuPdiPage() {
  const [aval, setAval] = useState<Avaliacao | null>(null)
  const [regua, setRegua] = useState<Faixa[]>([])
  const [skills, setSkills] = useState<Skill[]>([])
  const [dna, setDna] = useState<Dna[]>([])
  const [metas, setMetas] = useState<Meta[]>([])
  const [feedbacks, setFeedbacks] = useState<Feedback[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [openMes, setOpenMes] = useState<number | null>(null)

  const load = useCallback(async () => {
    try {
      setLoading(true); setError(null)
      const supabase = createClient()
      const { data, error: err } = await supabase.rpc('get_minha_avaliacao_pdi', { p_ano: ANO })
      if (err) { setError(err.message); return }
      const d = data as { avaliacao: Avaliacao; regua: Faixa[]; skills: Skill[]; dna: Dna[]; metas: Meta[]; feedbacks: Feedback[] }
      setAval(d.avaliacao); setRegua(d.regua || []); setSkills(d.skills || []); setDna(d.dna || [])
      setMetas(d.metas || []); setFeedbacks(d.feedbacks || [])
    } catch (e) { setError((e as Error).message) } finally { setLoading(false) }
  }, [])

  useEffect(() => { void load() }, [load])

  const bloqueada = aval?.bloqueada ?? false

  const setSkill = (id: string, patch: Partial<Skill>) => setSkills((prev) => prev.map((s) => s.id === id ? { ...s, ...patch } : s))
  const setDnaItem = (id: string, patch: Partial<Dna>) => setDna((prev) => prev.map((d) => d.id === id ? { ...d, ...patch } : d))
  const setFb = (id: string, patch: Partial<Feedback>) => setFeedbacks((prev) => prev.map((f) => f.id === id ? { ...f, ...patch } : f))
  const setMeta = (id: string, patch: Partial<Meta>) => setMetas((prev) => prev.map((m) => m.id === id ? { ...m, ...patch } : m))
  const addMeta = () => setMetas((prev) => [...prev, { id: tempId(), nome: '', descricao: '', indicadores: '', semestre: 1, progresso_pct: 0, _new: true }])
  const removeMeta = (id: string) => setMetas((prev) => prev.filter((m) => m.id !== id))

  const save = async (enviar: boolean) => {
    if (enviar && !window.confirm('Enviar a autoavaliação? Depois de enviada ela fica bloqueada para edição.')) return
    try {
      setSaving(true); setError(null); setMsg(null)
      const supabase = createClient()
      const { error: err } = await supabase.rpc('salvar_minha_avaliacao_pdi', {
        p_avaliacao_id: aval!.id,
        p_skills: skills.map((s) => ({ id: s.id, faixa_auto: s.faixa_auto, texto_auto: s.texto_auto })),
        p_dna: dna.map((d) => ({ id: d.id, faixa_auto: d.faixa_auto, texto_auto: d.texto_auto })),
        p_metas: metas.map((m) => ({ id: m._new ? '' : m.id, nome: m.nome, descricao: m.descricao, indicadores: m.indicadores, semestre: m.semestre, progresso_pct: m.progresso_pct })),
        p_feedbacks: feedbacks.map((f) => ({ id: f.id, realizado: f.realizado, funcionou: f.funcionou, nao_funcionou: f.nao_funcionou, onde_focar: f.onde_focar, persiste: f.persiste })),
        p_enviar: enviar,
      })
      if (err) { setError(err.message); return }
      setMsg(enviar ? 'Autoavaliação enviada!' : 'Rascunho salvo.')
      await load()
    } catch (e) { setError((e as Error).message) } finally { setSaving(false) }
  }

  const skillsPorTrilha = useMemo(() => {
    const g: Record<string, Record<number, Skill[]>> = {}
    for (const s of skills) { (g[s.trilha] ||= {})[s.pilar_numero] ||= []; g[s.trilha][s.pilar_numero].push(s) }
    return g
  }, [skills])

  function FaixaPicker({ value, onChange }: { value: string | null; onChange: (v: string) => void }) {
    return (
      <div className="flex flex-wrap gap-1">
        {regua.map((f) => (
          <button key={f.codigo} type="button" disabled={bloqueada}
            onClick={() => onChange(f.codigo)}
            className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${faixaColor(f.codigo, value === f.codigo)} ${bloqueada ? 'opacity-60' : 'hover:border-primary'}`}>
            {f.rotulo}
          </button>
        ))}
      </div>
    )
  }

  if (loading) return <div className="container mx-auto px-6 py-12"><p className="text-sm text-ink-mute">Carregando seu PDI…</p></div>
  if (error && !aval) return <div className="container mx-auto px-6 py-12"><p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p></div>

  return (
    <div className="container mx-auto max-w-4xl px-6 py-10 pb-28">
      <header className="mb-6">
        <span className="text-eyebrow">PESSOAS · PDI {ANO}</span>
        <h1 className="mt-2 display-lg text-ink">Meu PDI</h1>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <span className="rounded-full border border-hairline bg-card px-2.5 py-1 text-ink-secondary">{aval?.colaborador_nome}</span>
          <span className="rounded-full border border-hairline bg-card px-2.5 py-1 text-ink-secondary">{aval?.cargo_nome_snapshot}</span>
          {aval?.area_nome_snapshot ? <span className="rounded-full border border-hairline bg-card px-2.5 py-1 text-ink-secondary">{aval.area_nome_snapshot}</span> : null}
          {aval?.adicional_snapshot ? <span className="rounded-full bg-primary-soft-bg px-2.5 py-1 font-medium text-primary-soft-fg">Adicional: {aval.adicional_snapshot}</span> : null}
          <span className={`rounded-full px-2.5 py-1 font-medium ${bloqueada ? 'bg-emerald-50 text-emerald-700' : 'bg-secondary text-ink-secondary'}`}>{bloqueada ? 'Enviada' : 'Rascunho'}</span>
        </div>
        <Link href="/avaliacoes-pdi" className="mt-3 inline-block text-sm text-primary underline underline-offset-2">← Avaliações PDI</Link>
      </header>

      {bloqueada ? <p className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">Autoavaliação enviada — em modo leitura. Fale com seu coordenador para reabrir, se necessário.</p> : null}

      {/* SKILLS */}
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
                        <FaixaPicker value={s.faixa_auto} onChange={(v) => setSkill(s.id, { faixa_auto: v })} />
                        <textarea value={s.texto_auto || ''} disabled={bloqueada} onChange={(e) => setSkill(s.id, { texto_auto: e.target.value })}
                          placeholder="Desafios, conquistas, evidências…" rows={2}
                          className="mt-2 w-full resize-none rounded-md border border-hairline-input bg-background px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-ring disabled:opacity-60" />
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
        <div className="mb-3 flex items-center justify-between">
          <h2 className="display-md text-ink">Metas do PDI (semestrais)</h2>
          {!bloqueada ? <Button size="sm" variant="outline" onClick={addMeta}><Plus className="mr-1 h-3.5 w-3.5" /> Meta</Button> : null}
        </div>
        {metas.length === 0 ? <p className="rounded-xl border border-dashed border-hairline bg-canvas-soft p-4 text-sm text-ink-mute">Nenhuma meta ainda. Metas em baixa quantidade (1–4), ligadas à estratégia.</p> : null}
        <div className="space-y-3">
          {metas.map((m) => (
            <div key={m.id} className="rounded-xl border border-hairline bg-card p-4">
              <div className="flex items-center gap-2">
                <select value={m.semestre ?? 1} disabled={bloqueada} onChange={(e) => setMeta(m.id, { semestre: Number(e.target.value) })}
                  className="h-8 rounded-md border border-hairline-input bg-background px-2 text-sm text-ink disabled:opacity-60">
                  <option value={1}>1º semestre</option>
                  <option value={2}>2º semestre</option>
                </select>
                <input value={m.nome || ''} disabled={bloqueada} onChange={(e) => setMeta(m.id, { nome: e.target.value })} placeholder="Título da meta"
                  className="h-8 flex-1 rounded-md border border-hairline-input bg-background px-3 text-sm font-medium text-ink outline-none focus:ring-2 focus:ring-ring disabled:opacity-60" />
                {!bloqueada ? <button type="button" onClick={() => removeMeta(m.id)} className="text-destructive hover:opacity-70" title="Remover meta"><Trash2 className="h-4 w-4" /></button> : null}
              </div>
              <textarea value={m.descricao || ''} disabled={bloqueada} onChange={(e) => setMeta(m.id, { descricao: e.target.value })} placeholder="Descrição" rows={2}
                className="mt-2 w-full resize-none rounded-md border border-hairline-input bg-background px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-ring disabled:opacity-60" />
              <textarea value={m.indicadores || ''} disabled={bloqueada} onChange={(e) => setMeta(m.id, { indicadores: e.target.value })} placeholder="Indicadores" rows={2}
                className="mt-2 w-full resize-none rounded-md border border-hairline-input bg-background px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-ring disabled:opacity-60" />
              <div className="mt-2 flex items-center gap-2">
                <span className="text-xs text-ink-mute">Progresso</span>
                <input type="range" min={0} max={100} step={5} value={m.progresso_pct ?? 0} disabled={bloqueada} onChange={(e) => setMeta(m.id, { progresso_pct: Number(e.target.value) })} className="flex-1" />
                <span className="w-10 text-right font-tabular text-sm text-ink">{m.progresso_pct ?? 0}%</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* DNA */}
      <section className="mb-8">
        <h2 className="display-md mb-1 text-ink">DNA VLMA</h2>
        <p className="mb-3 text-sm text-ink-mute">Alinhamento cultural — não compõe o resultado; serve para celebrar e evidenciar pontos de melhoria.</p>
        <div className="space-y-2">
          {dna.map((d) => (
            <div key={d.id} className="rounded-xl border border-hairline bg-card p-4">
              <div className="text-sm font-medium text-ink"><span className="font-tabular text-primary">{d.numero}.</span> {d.nome}</div>
              <textarea value={d.texto_auto || ''} disabled={bloqueada} onChange={(e) => setDnaItem(d.id, { texto_auto: e.target.value })} placeholder="Como você vive esse valor? Exemplos…" rows={2}
                className="mt-2 w-full resize-none rounded-md border border-hairline-input bg-background px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-ring disabled:opacity-60" />
            </div>
          ))}
        </div>
      </section>

      {/* FEEDBACKS MENSAIS */}
      <section className="mb-8">
        <h2 className="display-md mb-3 text-ink">Feedbacks mensais</h2>
        <div className="overflow-hidden rounded-xl border border-hairline bg-card divide-y divide-hairline">
          {feedbacks.map((f) => {
            const open = openMes === f.mes
            const preenchido = f.realizado || f.funcionou || f.nao_funcionou || f.onde_focar || f.persiste
            return (
              <div key={f.id}>
                <button type="button" onClick={() => setOpenMes(open ? null : f.mes)} className="flex w-full items-center justify-between px-4 py-2.5 text-left hover:bg-canvas-soft">
                  <span className="flex items-center gap-2 text-sm text-ink">
                    {open ? <ChevronDown className="h-4 w-4 text-ink-mute" /> : <ChevronRight className="h-4 w-4 text-ink-mute" />}
                    {MESES[f.mes - 1]}
                  </span>
                  {preenchido ? <span className="h-2 w-2 rounded-full bg-primary" /> : <span className="text-xs text-ink-mute">—</span>}
                </button>
                {open ? (
                  <div className="space-y-2 border-t border-hairline bg-canvas-soft/40 p-4">
                    <label className="flex items-center gap-2 text-sm text-ink-secondary">
                      <input type="checkbox" checked={f.realizado} disabled={bloqueada} onChange={(e) => setFb(f.id, { realizado: e.target.checked })} /> Feedback realizado
                    </label>
                    {([['funcionou', 'O que funcionou'], ['nao_funcionou', 'O que não funcionou'], ['onde_focar', 'Onde focar'], ['persiste', 'O que persiste']] as const).map(([k, label]) => (
                      <textarea key={k} value={(f[k] as string) || ''} disabled={bloqueada} onChange={(e) => setFb(f.id, { [k]: e.target.value })} placeholder={label} rows={2}
                        className="w-full resize-none rounded-md border border-hairline-input bg-background px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-ring disabled:opacity-60" />
                    ))}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      </section>

      {/* SAVE BAR */}
      {!bloqueada ? (
        <div className="fixed inset-x-0 bottom-0 border-t border-hairline bg-card/95 backdrop-blur">
          <div className="container mx-auto flex max-w-4xl items-center justify-between gap-3 px-6 py-3">
            <span className="text-sm text-ink-mute">{msg || error || 'Salve como rascunho quantas vezes quiser; envie ao final.'}</span>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => void save(false)} disabled={saving}><Save className="mr-1 h-4 w-4" /> Salvar rascunho</Button>
              <Button onClick={() => void save(true)} disabled={saving}><Send className="mr-1 h-4 w-4" /> Enviar autoavaliação</Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
