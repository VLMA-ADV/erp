'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Copy, FileText, Lock, Paperclip, Plus, Save, Send, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { BarraProgresso, FaixaPicker } from '@/components/pdi/faixa'
import {
  PERIODOS,
  copiarMetas,
  destinosDeCopia,
  ordemPeriodo,
  rotuloPeriodo,
  validarEnvioPeriodo,
  type EnvioPeriodo,
  type MetaPeriodo,
  type PeriodoCodigo,
} from '@/lib/pdi/metas'
import {
  abrirAnexoMeta,
  anexarArquivos,
  carregarMinhasMetas,
  removerAnexo,
  salvarMetasPeriodo,
  validarArquivosMeta,
  type Faixa,
} from '@/lib/pdi/api'

function tempId() { return 'new-' + Math.random().toString(36).slice(2) }

const SESSAO_EXPIRADA =
  'Sua sessão expirou e as metas ainda NÃO foram salvas. Entre de novo em outra aba e volte aqui para salvar — não recarregue esta tela.'

function amigavel(msg: string): string {
  if (/permission denied|jwt|token|não autenticado/i.test(msg)) return SESSAO_EXPIRADA
  return msg
}

function dataCurta(iso: string | null | undefined): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('pt-BR')
}

/**
 * Metas do PDI por período (pedido do cliente 26/10): cada período é uma
 * seção com as metas, a autoavaliação, o progresso, comentário e anexos.
 * "Enviar autoavaliação" trava o período e manda para a caixa do coordenador
 * da área. A avaliação do sócio aparece desabilitada — é a segunda etapa.
 */
export default function MinhasMetas({ ano }: { ano: number }) {
  const [avaliacaoId, setAvaliacaoId] = useState<string | null>(null)
  const [tenantId, setTenantId] = useState<string>('')
  const [regua, setRegua] = useState<Faixa[]>([])
  const [metas, setMetas] = useState<MetaPeriodo[]>([])
  const [envios, setEnvios] = useState<EnvioPeriodo[]>([])
  const [abertos, setAbertos] = useState<Set<PeriodoCodigo>>(new Set())
  const [sujos, setSujos] = useState<Set<PeriodoCodigo>>(new Set())
  const [salvando, setSalvando] = useState<PeriodoCodigo | null>(null)
  const [anexando, setAnexando] = useState<string | null>(null)
  const [msg, setMsg] = useState<Partial<Record<PeriodoCodigo, { tipo: 'ok' | 'erro'; texto: string }>>>({})
  const [loading, setLoading] = useState(true)
  const [erroCarga, setErroCarga] = useState<string | null>(null)
  const [novoPeriodo, setNovoPeriodo] = useState<string>('')
  const sujosRef = useRef(sujos)
  sujosRef.current = sujos

  const carregar = useCallback(async (manterPeriodosSujos: boolean) => {
    const d = await carregarMinhasMetas(ano)
    setAvaliacaoId(d.avaliacao_id)
    setTenantId(d.tenant_id)
    setRegua(d.regua || [])
    setEnvios(d.periodos || [])
    setMetas((atual) => {
      if (!manterPeriodosSujos) return d.metas || []
      // Preserva o que ainda não foi salvo nos outros períodos.
      const sujosAgora = sujosRef.current
      return [
        ...(d.metas || []).filter((m) => !sujosAgora.has(m.periodo)),
        ...atual.filter((m) => sujosAgora.has(m.periodo)),
      ]
    })
  }, [ano])

  useEffect(() => {
    (async () => {
      try { setLoading(true); await carregar(false) }
      catch (e) { setErroCarga(amigavel((e as Error).message)) }
      finally { setLoading(false) }
    })()
  }, [carregar])

  // Avisa antes de sair com meta não salva.
  useEffect(() => {
    if (sujos.size === 0) return
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [sujos])

  const enviadoEm = useMemo(() => {
    const m = new Map<string, EnvioPeriodo>()
    for (const e of envios) m.set(e.periodo, e)
    return m
  }, [envios])
  const enviados = useMemo(() => new Set(envios.filter((e) => e.enviado_em).map((e) => e.periodo)), [envios])

  const periodosVisiveis = useMemo(() => {
    const s = new Set<PeriodoCodigo>(abertos)
    for (const m of metas) s.add(m.periodo)
    for (const e of envios) if (e.enviado_em) s.add(e.periodo)
    if (s.size === 0) s.add('S1')
    return Array.from(s).sort((a, b) => ordemPeriodo(a) - ordemPeriodo(b))
  }, [abertos, metas, envios])

  const marcarSujo = (p: PeriodoCodigo) => {
    setSujos((prev) => (prev.has(p) ? prev : new Set(prev).add(p)))
    setMsg((prev) => ({ ...prev, [p]: undefined }))
  }
  const setMeta = (id: string, patch: Partial<MetaPeriodo>) => {
    const alvo = metas.find((m) => m.id === id)
    if (!alvo) return
    setMetas((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)))
    marcarSujo(alvo.periodo)
  }
  const addMeta = (p: PeriodoCodigo) => {
    setMetas((prev) => [...prev, { id: tempId(), periodo: p, nome: '', comentario: null, progresso_pct: 0, faixa_auto: null, anexos: [], _new: true }])
    marcarSujo(p)
  }
  const removeMeta = (m: MetaPeriodo) => {
    const n = m.anexos?.length ?? 0
    if (n > 0 && !window.confirm(`Esta meta tem ${n} anexo(s). Eles serão apagados quando você salvar. Remover a meta?`)) return
    setMetas((prev) => prev.filter((x) => x.id !== m.id))
    marcarSujo(m.periodo)
  }

  const copiar = (origem: PeriodoCodigo, destino: PeriodoCodigo) => {
    const daOrigem = metas.filter((m) => m.periodo === origem)
    const doDestino = metas.filter((m) => m.periodo === destino)
    const novo = copiarMetas(daOrigem, doDestino, destino, tempId)
    const copiadas = novo.length - doDestino.length
    setMetas((prev) => [...prev.filter((m) => m.periodo !== destino), ...novo])
    setAbertos((prev) => new Set(prev).add(destino))
    if (copiadas > 0) marcarSujo(destino)
    setMsg((prev) => ({
      ...prev,
      [destino]: {
        tipo: 'ok',
        texto: copiadas > 0
          ? `${copiadas} meta(s) copiada(s) do ${rotuloPeriodo(origem)}. Faça a autoavaliação e salve.`
          : 'Todas as metas já existiam neste período.',
      },
    }))
    setTimeout(() => document.getElementById(`periodo-${destino}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }

  const salvar = async (p: PeriodoCodigo, enviar: boolean) => {
    if (!avaliacaoId) return
    const doPeriodo = metas.filter((m) => m.periodo === p)
    if (enviar) {
      const invalido = validarEnvioPeriodo(doPeriodo)
      if (invalido) { setMsg((prev) => ({ ...prev, [p]: { tipo: 'erro', texto: invalido } })); return }
      if (!window.confirm(`Enviar a autoavaliação do ${rotuloPeriodo(p)}? Depois de enviada ela fica travada e vai para o seu coordenador.`)) return
    }
    try {
      setSalvando(p)
      const { notificados } = await salvarMetasPeriodo(avaliacaoId, p, doPeriodo, enviar)
      setSujos((prev) => { const n = new Set(prev); n.delete(p); return n })
      sujosRef.current = new Set(Array.from(sujosRef.current).filter((x) => x !== p))
      await carregar(true)
      setMsg((prev) => ({
        ...prev,
        [p]: {
          tipo: 'ok',
          texto: enviar
            ? `Autoavaliação enviada${notificados > 0 ? ` — ${notificados === 1 ? 'seu coordenador foi avisado' : `${notificados} avaliadores foram avisados`} na caixa de entrada` : ''}.`
            : 'Rascunho salvo.',
        },
      }))
    } catch (e) {
      setMsg((prev) => ({ ...prev, [p]: { tipo: 'erro', texto: amigavel((e as Error).message) } }))
    } finally { setSalvando(null) }
  }

  const anexar = async (m: MetaPeriodo, files: FileList | null) => {
    if (!files || files.length === 0 || !avaliacaoId) return
    const lista = Array.from(files)
    const invalido = validarArquivosMeta(lista, m.anexos?.length ?? 0)
    if (invalido) { setMsg((prev) => ({ ...prev, [m.periodo]: { tipo: 'erro', texto: invalido } })); return }
    try {
      setAnexando(m.id)
      const novos = await anexarArquivos(tenantId, avaliacaoId, m.id, lista)
      setMetas((prev) => prev.map((x) => (x.id === m.id ? { ...x, anexos: [...(x.anexos ?? []), ...novos] } : x)))
    } catch (e) {
      setMsg((prev) => ({ ...prev, [m.periodo]: { tipo: 'erro', texto: amigavel((e as Error).message) } }))
    } finally { setAnexando(null) }
  }

  const desanexar = async (m: MetaPeriodo, anexoId: string) => {
    if (!window.confirm('Remover este anexo?')) return
    try {
      await removerAnexo(anexoId)
      setMetas((prev) => prev.map((x) => (x.id === m.id ? { ...x, anexos: (x.anexos ?? []).filter((a) => a.id !== anexoId) } : x)))
    } catch (e) {
      setMsg((prev) => ({ ...prev, [m.periodo]: { tipo: 'erro', texto: amigavel((e as Error).message) } }))
    }
  }

  const abrir = async (path: string) => {
    try { await abrirAnexoMeta(path) } catch (e) { window.alert((e as Error).message) }
  }

  if (loading) return <p className="text-sm text-ink-mute">Carregando suas metas…</p>
  if (erroCarga) return <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{erroCarga}</p>
  if (!avaliacaoId) return <p className="text-sm text-ink-mute">Sua avaliação do ciclo ainda não foi criada.</p>

  const periodosDisponiveis = PERIODOS.filter((p) => !periodosVisiveis.includes(p.codigo))

  return (
    <section className="mb-10" data-testid="pdi-minhas-metas">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h2 className="display-md text-ink">Minhas metas {ano}</h2>
      </div>
      <p className="mb-4 text-sm text-ink-mute">
        Lance suas metas, dê a sua autoavaliação e envie. Depois de enviada, a autoavaliação do período fica travada
        e vai para o coordenador da sua área, que faz a segunda etapa (avaliação do sócio e nota final).
      </p>

      <div className="space-y-6">
        {periodosVisiveis.map((p) => {
          const lista = metas.filter((m) => m.periodo === p)
          const envio = enviadoEm.get(p)
          const travado = Boolean(envio?.enviado_em)
          const sujo = sujos.has(p)
          const destinos = destinosDeCopia(p, enviados)
          const aviso = msg[p]
          return (
            <div key={p} id={`periodo-${p}`} className="overflow-hidden rounded-xl border border-hairline bg-card" data-testid={`pdi-periodo-${p}`}>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline bg-canvas-soft px-4 py-3">
                <div>
                  <h3 className="text-sm font-semibold text-ink">{rotuloPeriodo(p)} · {ano}</h3>
                  <p className="text-xs text-ink-mute">
                    {lista.length} meta(s)
                    {lista.length > 0 ? ` · progresso médio ${Math.round(lista.reduce((s, m) => s + (m.progresso_pct ?? 0), 0) / lista.length)}%` : ''}
                  </p>
                </div>
                {travado ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
                    <Lock className="h-3 w-3" /> Enviada em {dataCurta(envio?.enviado_em)}
                  </span>
                ) : envio?.reaberto_em ? (
                  <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700">Reaberta pelo coordenador em {dataCurta(envio.reaberto_em)}</span>
                ) : (
                  <span className="rounded-full bg-secondary px-2.5 py-1 text-[11px] font-medium text-ink-secondary">{sujo ? 'Alterações não salvas' : 'Rascunho'}</span>
                )}
              </div>

              <div className="divide-y divide-hairline">
                {lista.length === 0 ? (
                  <p className="p-4 text-sm text-ink-mute">Nenhuma meta neste período ainda.</p>
                ) : null}
                {lista.map((m, idx) => (
                  <div key={m.id} className="space-y-3 p-4" data-testid="pdi-meta">
                    <div className="flex items-center gap-2">
                      <span className="w-6 shrink-0 font-tabular text-sm text-ink-mute">{idx + 1}.</span>
                      <input
                        value={m.nome || ''}
                        disabled={travado}
                        onChange={(e) => setMeta(m.id, { nome: e.target.value })}
                        placeholder="Nome da meta"
                        aria-label="Nome da meta"
                        className="h-9 flex-1 rounded-md border border-hairline-input bg-background px-3 text-sm font-medium text-ink outline-none focus:ring-2 focus:ring-ring disabled:opacity-70"
                      />
                      {!travado ? (
                        <button type="button" onClick={() => removeMeta(m)} className="text-destructive hover:opacity-70" title="Remover meta" aria-label="Remover meta">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      ) : null}
                    </div>
                    {m.descricao || m.indicadores ? (
                      <div className="ml-8 space-y-0.5 text-xs text-ink-mute">
                        {m.descricao ? <p className="whitespace-pre-wrap">{m.descricao}</p> : null}
                        {m.indicadores ? <p className="whitespace-pre-wrap">Indicadores: {m.indicadores}</p> : null}
                      </div>
                    ) : null}

                    <div className="ml-8 grid gap-3 md:grid-cols-2">
                      <div className="rounded-lg border border-hairline bg-canvas-soft/50 p-3">
                        <p className="text-eyebrow mb-1.5">Autoavaliação</p>
                        <FaixaPicker regua={regua} value={m.faixa_auto} disabled={travado} ariaLabel="Autoavaliação"
                          onChange={(v) => setMeta(m.id, { faixa_auto: v })} />
                      </div>
                      <div className="rounded-lg border border-dashed border-hairline p-3" title="Segunda etapa — preenchida pelo coordenador/sócio">
                        <p className="text-eyebrow mb-1.5">Avaliação do sócio <span className="normal-case tracking-normal text-ink-mute">· 2ª etapa</span></p>
                        <FaixaPicker regua={regua} value={m.faixa_final ?? null} disabled ariaLabel="Avaliação do sócio" />
                      </div>
                    </div>

                    <div className="ml-8">
                      <div className="flex items-center gap-3">
                        <span className="w-20 shrink-0 text-xs text-ink-mute">Progresso</span>
                        <input type="range" min={0} max={100} step={5} value={m.progresso_pct ?? 0} disabled={travado}
                          aria-label="Progresso da meta"
                          onChange={(e) => setMeta(m.id, { progresso_pct: Number(e.target.value) })} className="flex-1 accent-primary disabled:opacity-60" />
                        <span className="w-10 text-right font-tabular text-sm text-ink">{m.progresso_pct ?? 0}%</span>
                      </div>
                      <BarraProgresso valor={m.progresso_pct ?? 0} className="ml-[5.75rem] mt-1" />
                    </div>

                    <textarea
                      value={m.comentario || ''}
                      disabled={travado}
                      onChange={(e) => setMeta(m.id, { comentario: e.target.value })}
                      placeholder="Comentários: o que foi entregue, evidências, próximos passos…"
                      aria-label="Comentários da meta"
                      rows={2}
                      className="ml-8 w-[calc(100%-2rem)] resize-none rounded-md border border-hairline-input bg-background px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-ring disabled:opacity-70"
                    />

                    <div className="ml-8 flex flex-wrap items-center gap-2">
                      {(m.anexos ?? []).map((a) => (
                        <span key={a.id} className="inline-flex items-center gap-1 rounded-full border border-hairline bg-canvas-soft px-2 py-1 text-xs text-ink-secondary">
                          <button type="button" onClick={() => void abrir(a.storage_path)} className="inline-flex items-center gap-1 hover:text-primary" title="Abrir anexo">
                            <FileText className="h-3.5 w-3.5" /> <span className="max-w-[12rem] truncate">{a.arquivo_nome}</span>
                          </button>
                          {!travado ? (
                            <button type="button" onClick={() => void desanexar(m, a.id)} className="text-ink-mute hover:text-destructive" aria-label={`Remover ${a.arquivo_nome}`}>
                              <X className="h-3 w-3" />
                            </button>
                          ) : null}
                        </span>
                      ))}
                      {!travado ? (
                        m._new ? (
                          <span className="text-xs text-ink-mute">Salve o rascunho para anexar arquivos a esta meta.</span>
                        ) : (
                          <label className={`inline-flex cursor-pointer items-center gap-1 rounded-md border border-hairline px-2 py-1 text-xs text-ink-secondary hover:border-primary ${anexando === m.id ? 'pointer-events-none opacity-60' : ''}`}>
                            <Paperclip className="h-3.5 w-3.5" /> {anexando === m.id ? 'Enviando…' : 'Anexar arquivo'}
                            <input type="file" multiple className="hidden" onChange={(e) => { void anexar(m, e.target.files); e.target.value = '' }} />
                          </label>
                        )
                      ) : (m.anexos ?? []).length === 0 ? <span className="text-xs text-ink-mute">Sem anexos</span> : null}
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-hairline bg-canvas-soft/40 px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  {!travado ? (
                    <Button size="sm" variant="outline" onClick={() => addMeta(p)}><Plus className="mr-1 h-3.5 w-3.5" /> Meta</Button>
                  ) : null}
                  {lista.length > 0 && destinos.length > 0 ? (
                    <CopiarPara destinos={destinos} onCopiar={(d) => copiar(p, d)} />
                  ) : null}
                </div>
                {!travado ? (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" disabled={salvando !== null} onClick={() => void salvar(p, false)}>
                      <Save className="mr-1 h-3.5 w-3.5" /> Salvar rascunho
                    </Button>
                    <Button size="sm" disabled={salvando !== null || lista.length === 0} onClick={() => void salvar(p, true)}>
                      <Send className="mr-1 h-3.5 w-3.5" /> Enviar autoavaliação
                    </Button>
                  </div>
                ) : (
                  <span className="text-xs text-ink-mute">Para alterar, peça ao seu coordenador para reabrir este período.</span>
                )}
              </div>
              {aviso ? (
                <p role="status" className={`border-t px-4 py-2 text-sm ${aviso.tipo === 'erro' ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
                  {salvando === p ? 'Salvando…' : aviso.texto}
                </p>
              ) : null}
            </div>
          )
        })}
      </div>

      {periodosDisponiveis.length > 0 ? (
        <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-ink-mute">Abrir outro período em branco:</span>
          <select value={novoPeriodo} onChange={(e) => setNovoPeriodo(e.target.value)} aria-label="Período para abrir"
            className="h-8 rounded-md border border-hairline-input bg-background px-2 text-sm text-ink">
            <option value="">Escolha…</option>
            {periodosDisponiveis.map((p) => <option key={p.codigo} value={p.codigo}>{p.rotulo}</option>)}
          </select>
          <Button size="sm" variant="outline" disabled={!novoPeriodo} onClick={() => {
            const p = novoPeriodo as PeriodoCodigo
            setAbertos((prev) => new Set(prev).add(p))
            setNovoPeriodo('')
            addMeta(p)
          }}>Abrir</Button>
        </div>
      ) : null}
    </section>
  )
}

function CopiarPara({ destinos, onCopiar }: { destinos: PeriodoCodigo[]; onCopiar: (d: PeriodoCodigo) => void }) {
  const [destino, setDestino] = useState<PeriodoCodigo>(destinos[0])
  useEffect(() => { if (!destinos.includes(destino)) setDestino(destinos[0]) }, [destinos, destino])
  return (
    <span className="inline-flex items-center gap-1">
      <Button size="sm" variant="outline" onClick={() => onCopiar(destino)} title="Copia nome e descrição das metas; a autoavaliação do novo período começa em branco">
        <Copy className="mr-1 h-3.5 w-3.5" /> Copiar as metas acima para
      </Button>
      <select value={destino} onChange={(e) => setDestino(e.target.value as PeriodoCodigo)} aria-label="Período de destino da cópia"
        className="h-8 rounded-md border border-hairline-input bg-background px-2 text-sm text-ink">
        {destinos.map((d) => <option key={d} value={d}>{rotuloPeriodo(d)}</option>)}
      </select>
    </span>
  )
}
