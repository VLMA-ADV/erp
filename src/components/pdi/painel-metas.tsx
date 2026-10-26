'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ChevronDown, ChevronRight, Paperclip } from 'lucide-react'
import { DonutBreakdown } from '@/components/ui/donut-breakdown'
import { BarraProgresso, FAIXA_HEX, FaixaBadge, progressoHex } from '@/components/pdi/faixa'
import { PERIODOS, agregarPainel, curtoPeriodo, rotuloPeriodo, type PeriodoCodigo, type PessoaResumo } from '@/lib/pdi/metas'
import { carregarAvaliacaoPrevia, carregarPainelMetas, type PainelResposta } from '@/lib/pdi/api'
import { previaPorColaborador, type PreviaPessoa } from '@/lib/pdi/previa'
import AvaliacaoPrevia from '@/components/pdi/avaliacao-previa'

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-hairline bg-card p-4 ${className}`}>{children}</div>
}

/**
 * Painel das metas do PDI. O colaborador vê o próprio progresso; quem avalia
 * vê a equipe com a mesma regra de get_equipe_avaliacoes_pdi (sócio e adm VLMA
 * veem todos; coordenador, a própria área). A RPC devolve linhas cruas e a
 * agregação é feita em agregarPainel (testada).
 */
export default function PainelMetas({ ano }: { ano: number }) {
  const [dados, setDados] = useState<PainelResposta | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [periodo, setPeriodo] = useState<PeriodoCodigo | ''>('')
  const [area, setArea] = useState('')
  const [busca, setBusca] = useState('')
  const [abertaArea, setAbertaArea] = useState<string | null>(null)
  const [abertaPessoa, setAbertaPessoa] = useState<string | null>(null)
  const [previa, setPrevia] = useState<Map<string, PreviaPessoa> | null>(null)
  const [erroPrevia, setErroPrevia] = useState<string | null>(null)

  useEffect(() => {
    carregarPainelMetas(ano).then(setDados).catch((e: Error) => setErro(e.message))
    // A avaliação prévia é um bloco à parte: se falhar, o painel continua.
    carregarAvaliacaoPrevia(ano).then((r) => setPrevia(previaPorColaborador(r))).catch((e: Error) => setErroPrevia(e.message))
  }, [ano])

  const resumo = useMemo(() => {
    if (!dados) return null
    const termo = busca.trim().toLowerCase()
    const pessoas = termo ? dados.pessoas.filter((p) => p.nome.toLowerCase().includes(termo)) : dados.pessoas
    return agregarPainel({ ...dados, pessoas }, { periodo: periodo || null, area: area || null })
  }, [dados, periodo, area, busca])

  const areas = useMemo(() => Array.from(new Set((dados?.pessoas ?? []).map((p) => p.area))).sort((a, b) => a.localeCompare(b, 'pt-BR')), [dados])

  if (erro) return <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{erro}</p>
  if (!dados || !resumo) return <p className="text-sm text-ink-mute">Carregando painel…</p>

  const proprio = dados.escopo === 'proprio'
  const rotuloFaixa = (c: string) => dados.regua.find((f) => f.codigo === c)?.rotulo ?? c
  const k = resumo.kpis
  const kpis = proprio
    ? [
        { label: 'Metas', value: k.metas, sub: periodo ? rotuloPeriodo(periodo) : 'todos os períodos' },
        { label: 'Progresso médio', value: k.progressoMedio == null ? '—' : `${k.progressoMedio}%`, sub: 'média das metas' },
        { label: 'Períodos enviados', value: k.enviados, sub: 'autoavaliação enviada' },
        { label: 'Períodos em aberto', value: k.pendentes, sub: 'ainda não enviados' },
      ]
    : [
        { label: 'Pessoas', value: k.pessoas, sub: `${k.pessoasComMetas} com metas` },
        { label: 'Metas', value: k.metas, sub: periodo ? rotuloPeriodo(periodo) : 'todos os períodos' },
        { label: 'Progresso médio', value: k.progressoMedio == null ? '—' : `${k.progressoMedio}%`, sub: 'média das metas' },
        { label: 'Enviados', value: k.enviados, sub: 'pessoa × período' },
        { label: 'Pendentes', value: k.pendentes, sub: 'com meta, sem envio' },
      ]
  const maxFaixa = Math.max(1, ...resumo.porFaixa.map((f) => f.total))

  return (
    <div className="space-y-4" data-testid="pdi-painel-metas">
      <div className="flex flex-wrap items-center gap-2">
        <select value={periodo} onChange={(e) => setPeriodo(e.target.value as PeriodoCodigo | '')} aria-label="Filtrar por período"
          className="h-9 rounded-md border border-hairline-input bg-background px-2 text-sm text-ink">
          <option value="">Todos os períodos</option>
          {PERIODOS.map((p) => <option key={p.codigo} value={p.codigo}>{p.rotulo}</option>)}
        </select>
        {!proprio && areas.length > 1 ? (
          <select value={area} onChange={(e) => setArea(e.target.value)} aria-label="Filtrar por área"
            className="h-9 rounded-md border border-hairline-input bg-background px-2 text-sm text-ink">
            <option value="">Todas as áreas</option>
            {areas.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        ) : null}
        {!proprio ? (
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar pessoa…" aria-label="Buscar pessoa"
            className="h-9 w-56 rounded-md border border-hairline-input bg-background px-3 text-sm text-ink outline-none focus:ring-2 focus:ring-ring" />
        ) : null}
        <span className="text-xs text-ink-mute">
          {dados.escopo === 'todos' ? 'Você vê todas as áreas.' : dados.escopo === 'area' ? `Você vê a área ${dados.area_nome ?? ''}.` : 'Seu progresso.'}
        </span>
      </div>

      <div className={`grid grid-cols-2 gap-3 ${proprio ? 'md:grid-cols-4' : 'md:grid-cols-5'}`}>
        {kpis.map((c) => (
          <Card key={c.label}>
            <p className="text-eyebrow">{c.label}</p>
            <p className="mt-1 font-tabular text-3xl font-light text-ink">{c.value}</p>
            <p className="mt-0.5 text-xs text-ink-mute">{c.sub}</p>
          </Card>
        ))}
      </div>

      <div className={`grid grid-cols-1 gap-3 ${proprio ? 'lg:grid-cols-2' : 'lg:grid-cols-3'}`}>
        {!proprio ? (
          <Card>
            <p className="text-eyebrow mb-3">Progresso médio por área</p>
            <ul className="space-y-2">
              {resumo.porArea.map((a) => (
                <li key={a.area} className="flex items-center gap-2 text-xs">
                  <span className="w-28 shrink-0 truncate text-ink-secondary" title={a.area}>{a.area}</span>
                  <div className="h-3 flex-1 overflow-hidden rounded-full bg-secondary">
                    <div className="h-full rounded-full" style={{ width: `${a.progresso ?? 0}%`, background: progressoHex(a.progresso ?? 0) }} />
                  </div>
                  <span className="w-10 shrink-0 text-right font-tabular font-medium text-ink">{a.progresso == null ? '—' : `${a.progresso}%`}</span>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
        <Card>
          <p className="text-eyebrow mb-3">Autoavaliações por faixa</p>
          <ul className="space-y-2">
            {resumo.porFaixa.map((f) => (
              <li key={f.codigo} className="flex items-center gap-2 text-xs">
                <span className="w-32 shrink-0 truncate text-ink-secondary">{rotuloFaixa(f.codigo)}</span>
                <div className="h-3 flex-1 overflow-hidden rounded-full bg-secondary">
                  <div className="h-full rounded-full" style={{ width: `${(f.total / maxFaixa) * 100}%`, background: FAIXA_HEX[f.codigo] }} />
                </div>
                <span className="w-8 shrink-0 text-right font-tabular font-medium text-ink">{f.total}</span>
              </li>
            ))}
            <li className="pt-1 text-xs text-ink-mute">Sem autoavaliação: <span className="font-tabular">{resumo.semAutoavaliacao}</span></li>
          </ul>
        </Card>
        <DonutBreakdown titulo="Envio da autoavaliação" grupos={[
          { label: 'Enviados', count: k.enviados },
          { label: 'Pendentes', count: k.pendentes },
        ]} />
      </div>

      {proprio ? (
        <Card>
          <p className="text-eyebrow mb-3">Minhas metas</p>
          {resumo.pessoas[0] ? <MetasDaPessoa r={resumo.pessoas[0]} regua={dados.regua} /> : null}
          <Link href="/avaliacoes-pdi/meu" className="mt-3 inline-block text-sm text-primary underline underline-offset-2">Editar no Meu PDI →</Link>
        </Card>
      ) : null}

      {proprio ? (
        <Card>
          <p className="text-eyebrow mb-1">Avaliação prévia</p>
          <p className="mb-3 text-xs text-ink-mute">Resumo do que ficou gravado da avaliação anterior — skills da carreira e DNA VLMA. Só leitura.</p>
          <BlocoPrevia previa={previa} erro={erroPrevia} colaboradorId={resumo.pessoas[0]?.pessoa.colaborador_id} regua={dados.regua} />
        </Card>
      ) : (
        <Card>
          <p className="text-eyebrow mb-3">Por área</p>
          <div className="divide-y divide-hairline">
            {resumo.porArea.map((a) => {
              const open = abertaArea === a.area || resumo.porArea.length === 1
              return (
                <div key={a.area}>
                  <button type="button" onClick={() => setAbertaArea(open ? null : a.area)} className="flex w-full items-center justify-between gap-2 py-2.5 text-left">
                    <span className="flex items-center gap-1.5 text-sm font-medium text-ink">
                      {open ? <ChevronDown className="h-4 w-4 text-ink-mute" /> : <ChevronRight className="h-4 w-4 text-ink-mute" />}
                      {a.area}
                    </span>
                    <span className="flex items-center gap-3 text-xs text-ink-mute">
                      <span>{a.pessoas} pessoas · {a.metas} metas</span>
                      <span className="w-10 text-right font-tabular font-semibold" style={{ color: progressoHex(a.progresso ?? 0) }}>{a.progresso == null ? '—' : `${a.progresso}%`}</span>
                    </span>
                  </button>
                  {open ? (
                    <ul className="mb-2 space-y-1 pl-6">
                      {a.integrantes.map((r) => {
                        const pOpen = abertaPessoa === r.pessoa.colaborador_id
                        return (
                          <li key={r.pessoa.colaborador_id} className="rounded-lg border border-hairline">
                            <button type="button" onClick={() => setAbertaPessoa(pOpen ? null : r.pessoa.colaborador_id)}
                              className="flex w-full flex-wrap items-center gap-3 px-3 py-2 text-left hover:bg-canvas-soft">
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm text-ink">{r.pessoa.nome}</span>
                                <span className="block truncate text-xs text-ink-mute">{r.pessoa.cargo ?? '—'} · {r.metas.length} meta(s)</span>
                              </span>
                              <span className="flex flex-wrap gap-1">
                                {r.periodos.length === 0 ? <span className="rounded-full bg-canvas-soft px-2 py-0.5 text-[11px] text-ink-mute">Sem metas</span> : null}
                                {r.periodos.map((pp) => (
                                  <span key={pp.periodo} className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${pp.enviado ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}
                                    title={pp.enviado ? `Enviado em ${new Date(pp.enviado_em!).toLocaleDateString('pt-BR')}` : 'Ainda não enviado'}>
                                    {curtoPeriodo(pp.periodo)} {pp.enviado ? '✓' : '…'}
                                  </span>
                                ))}
                              </span>
                              <span className="flex w-36 items-center gap-2">
                                <BarraProgresso valor={r.progresso ?? 0} className="flex-1" />
                                <span className="w-9 text-right font-tabular text-xs text-ink">{r.progresso == null ? '—' : `${r.progresso}%`}</span>
                              </span>
                            </button>
                            {pOpen ? (
                              <div className="border-t border-hairline px-3 py-2">
                                <MetasDaPessoa r={r} regua={dados.regua} />
                                <div className="mt-3 rounded-lg border border-dashed border-hairline p-3">
                                  <p className="text-eyebrow mb-2">Avaliação prévia</p>
                                  <BlocoPrevia previa={previa} erro={erroPrevia} colaboradorId={r.pessoa.colaborador_id} regua={dados.regua} />
                                </div>
                                {r.pessoa.avaliacao_id ? (
                                  <Link href={`/avaliacoes-pdi/equipe/${r.pessoa.avaliacao_id}?aba=metas`} className="mt-2 inline-block text-xs text-primary underline underline-offset-2">Abrir avaliação →</Link>
                                ) : null}
                              </div>
                            ) : null}
                          </li>
                        )
                      })}
                    </ul>
                  ) : null}
                </div>
              )
            })}
          </div>
        </Card>
      )}
    </div>
  )
}

function BlocoPrevia({ previa, erro, colaboradorId, regua }: {
  previa: Map<string, PreviaPessoa> | null
  erro: string | null
  colaboradorId: string | undefined
  regua: { codigo: string; rotulo: string }[]
}) {
  if (erro) return <p className="text-xs text-red-700">{erro}</p>
  if (!previa) return <p className="text-xs text-ink-mute">Carregando avaliação prévia…</p>
  return <AvaliacaoPrevia pessoa={colaboradorId ? previa.get(colaboradorId) : undefined} regua={regua} />
}

function MetasDaPessoa({ r, regua }: { r: PessoaResumo; regua: { codigo: string; rotulo: string }[] }) {
  if (r.metas.length === 0) return <p className="text-sm text-ink-mute">Nenhuma meta no filtro.</p>
  return (
    <ul className="divide-y divide-hairline">
      {r.metas.map((m) => (
        <li key={m.meta_id} className="flex flex-wrap items-center gap-3 py-2 text-xs">
          <span className="w-12 shrink-0 text-ink-mute">{curtoPeriodo(m.periodo)}</span>
          <span className="min-w-0 flex-1 truncate text-sm text-ink" title={m.nome ?? ''}>{m.nome || 'Meta'}</span>
          {m.qtd_anexos > 0 ? <span className="inline-flex items-center gap-0.5 text-ink-mute" title="Anexos"><Paperclip className="h-3 w-3" />{m.qtd_anexos}</span> : null}
          <FaixaBadge regua={regua} codigo={m.faixa_auto} />
          <span className="flex w-32 items-center gap-2">
            <BarraProgresso valor={m.progresso_pct} className="flex-1" />
            <span className="w-9 text-right font-tabular text-ink">{m.progresso_pct}%</span>
          </span>
        </li>
      ))}
    </ul>
  )
}
