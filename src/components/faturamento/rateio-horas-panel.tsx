'use client'

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { CommandSelect, type CommandSelectOption } from '@/components/ui/command-select'
import { DonutBreakdown } from '@/components/ui/donut-breakdown'
import { formatHorasMin } from '@/lib/utils/format-horas'
import { competenciaAtual, rotuloCompetencia } from '@/lib/faturamento/competencia'
import {
  ROTULO_ETAPA,
  ROTULO_SITUACAO,
  competenciaInicialDoRateio,
  competenciasDoRateio,
  cut,
  cutSeCobrarRevisao,
  filtrarRateio,
  formatarCut,
  lerLancamentosRateio,
  montarRelatorio,
  nomeCentroCusto,
  opcoesDosFiltros,
  rotuloCaso,
  type FiltrosRateio,
  type LancamentoRateio,
  type SituacaoRateio,
  type TotaisRateio,
} from '@/lib/faturamento/rateio-horas'

/**
 * Rateio / horas — relatório para sócios e financeiro: horas lançadas x
 * cobradas no mês de faturamento e a divisão das cobradas por centro de custo
 * (área de quem lançou). Só casos que cobram por hora.
 *
 * Os dados vêm de get_rateio_horas (que barra quem não é sócio/financeiro);
 * toda a conta está em lib/faturamento/rateio-horas.
 *
 * Hora "em revisão" (na fila, em revisão, em aprovação) ainda não é cobrada,
 * então entra no cut. Para o número não parecer pior do que vai ficar, o card
 * de cut diz quanto ainda está em revisão e qual seria o cut se tudo isso
 * fosse cobrado; na tabela, as horas em revisão aparecem em âmbar embaixo das
 * cobradas.
 */

const h = formatHorasMin

function fmtData(iso: string) {
  const [a, m, d] = iso.slice(0, 10).split('-')
  return d && m && a ? `${d}/${m}/${a}` : iso || '—'
}

const COR_SITUACAO: Record<SituacaoRateio, string> = {
  cobrada: 'bg-emerald-50 text-emerald-700',
  cortada: 'bg-red-50 text-red-700',
  em_revisao: 'bg-amber-50 text-amber-800',
}

function CelulaCut({ totais }: { totais: TotaisRateio }) {
  const valor = cut(totais)
  return (
    <span className={valor !== null && valor > 0 ? 'text-red-600' : 'text-ink-secondary'}>
      {formatarCut(valor)}
    </span>
  )
}

/** Cobradas em cima; em revisão (âmbar) embaixo, só quando houver. */
function CelulaCobradas({ totais }: { totais: TotaisRateio }) {
  return (
    <div className="leading-tight">
      <div className="font-medium text-ink">{h(totais.cobradas)}</div>
      {totais.emRevisao > 0 ? (
        <div className="text-[10px] text-amber-700" title="Horas lançadas ainda em revisão/aprovação ou na fila: ainda podem ser cobradas">
          + {h(totais.emRevisao)} em revisão
        </div>
      ) : null}
    </div>
  )
}

export default function RateioHorasPanel({ competenciaInicial }: { competenciaInicial?: string }) {
  const atual = competenciaAtual()
  const abas = useMemo(() => competenciasDoRateio(atual), [atual])
  const [competencia, setCompetencia] = useState(() => competenciaInicialDoRateio(competenciaInicial, atual))
  const [lancamentos, setLancamentos] = useState<LancamentoRateio[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [filtros, setFiltros] = useState<FiltrosRateio>({})
  const [abertos, setAbertos] = useState<Set<string>>(new Set())
  const seq = useRef(0)

  const carregar = useCallback(async (comp: string) => {
    const minha = ++seq.current
    try {
      setCarregando(true)
      setErro(null)
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data, error } = await supabase.rpc('get_rateio_horas', { p_user_id: user.id, p_competencia: comp })
      if (minha !== seq.current) return
      if (error) throw error
      setLancamentos(lerLancamentosRateio(data))
    } catch (err) {
      if (minha !== seq.current) return
      console.error('get_rateio_horas', err)
      setLancamentos([])
      setErro('Não foi possível carregar o rateio de horas deste mês.')
    } finally {
      if (minha === seq.current) setCarregando(false)
    }
  }, [])

  useEffect(() => {
    setAbertos(new Set())
    void carregar(competencia)
  }, [competencia, carregar])

  const opcoes = useMemo(() => opcoesDosFiltros(lancamentos, filtros.cliente), [lancamentos, filtros.cliente])
  const filtrados = useMemo(() => filtrarRateio(lancamentos, filtros), [lancamentos, filtros])
  const relatorio = useMemo(() => montarRelatorio(filtrados), [filtrados])
  const { totais, centrosCusto, casos } = relatorio
  const temFiltro = Boolean(filtros.usuario || filtros.centroCusto || filtros.cliente || filtros.caso)

  // Filtro que sumiu ao trocar de mês (usuário sem hora no mês novo) é limpo,
  // senão a tela fica vazia sem motivo aparente.
  useEffect(() => {
    if (carregando) return
    setFiltros((f) => {
      const tem = (lista: { value: string }[], v?: string) => !v || lista.some((o) => o.value === v)
      const todos = opcoesDosFiltros(lancamentos)
      const next: FiltrosRateio = {
        usuario: tem(todos.usuarios, f.usuario) ? f.usuario : undefined,
        centroCusto: tem(todos.centrosCusto, f.centroCusto) ? f.centroCusto : undefined,
        cliente: tem(todos.clientes, f.cliente) ? f.cliente : undefined,
        caso: tem(todos.casos, f.caso) ? f.caso : undefined,
      }
      return JSON.stringify(next) === JSON.stringify(f) ? f : next
    })
  }, [lancamentos, carregando])

  const comTodos = (todos: string, lista: { value: string; label: string }[]): CommandSelectOption[] => [
    { value: '', label: todos },
    ...lista,
  ]

  const alternar = (casoId: string) =>
    setAbertos((prev) => {
      const next = new Set(prev)
      if (next.has(casoId)) next.delete(casoId)
      else next.add(casoId)
      return next
    })

  const cutAtual = cut(totais)
  const cutPiso = cutSeCobrarRevisao(totais)
  const colunasFixas = 5 // cliente, caso, lançadas, cobradas, cut

  return (
    <div className="space-y-4">
      {/* Mesmas abas por mês de faturamento da tela de faturamento, desde agosto/2026. */}
      <div className="flex flex-wrap items-end gap-1 border-b border-hairline" role="tablist" aria-label="Mês de faturamento do rateio">
        {abas.map((comp) => {
          const ativa = comp === competencia
          return (
            <button
              key={comp}
              type="button"
              role="tab"
              aria-selected={ativa}
              onClick={() => setCompetencia(comp)}
              className={`-mb-px inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm transition-colors ${
                ativa ? 'border-ink font-semibold text-ink' : 'border-transparent text-ink-mute hover:text-ink-secondary'
              }`}
            >
              {rotuloCompetencia(comp)}
              {comp === atual ? <span className="text-[11px] font-normal text-ink-mute">· este mês</span> : null}
            </button>
          )
        })}
      </div>

      <p className="text-[11px] text-ink-mute">
        Só casos que cobram por hora. Competência de faturamento: a aba de um mês mostra as horas faturadas nele
        (trabalhadas no mês anterior). Centro de custo = área de quem lançou. Cobradas = horas aprovadas no
        faturamento (aprovado ou faturado); ignorado ou excluído da fila conta como cortado.
      </p>

      <div className="grid gap-3 md:grid-cols-4">
        <div className="space-y-1">
          <label className="text-sm font-medium">Usuário</label>
          <CommandSelect
            value={filtros.usuario ?? ''}
            onValueChange={(v) => setFiltros((f) => ({ ...f, usuario: v || undefined }))}
            options={comTodos('Todos os usuários', opcoes.usuarios)}
            placeholder="Todos os usuários"
            searchPlaceholder="Buscar usuário..."
            emptyText="Nenhum usuário."
          />
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium">Centro de custo</label>
          <CommandSelect
            value={filtros.centroCusto ?? ''}
            onValueChange={(v) => setFiltros((f) => ({ ...f, centroCusto: v || undefined }))}
            options={comTodos('Todos os centros de custo', opcoes.centrosCusto)}
            placeholder="Todos os centros de custo"
            searchPlaceholder="Buscar centro de custo..."
            emptyText="Nenhum centro de custo."
          />
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium">Cliente</label>
          <CommandSelect
            value={filtros.cliente ?? ''}
            onValueChange={(v) => setFiltros((f) => ({ ...f, cliente: v || undefined, caso: undefined }))}
            options={comTodos('Todos os clientes', opcoes.clientes)}
            placeholder="Todos os clientes"
            searchPlaceholder="Buscar cliente..."
            emptyText="Nenhum cliente."
          />
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium">Caso</label>
          <CommandSelect
            value={filtros.caso ?? ''}
            onValueChange={(v) => setFiltros((f) => ({ ...f, caso: v || undefined }))}
            options={comTodos('Todos os casos', opcoes.casos)}
            placeholder="Todos os casos"
            searchPlaceholder="Buscar caso..."
            emptyText="Nenhum caso."
          />
        </div>
      </div>
      {temFiltro ? (
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={() => setFiltros({})}>
            Limpar filtros
          </Button>
        </div>
      ) : null}

      {erro ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{erro}</div>
      ) : carregando ? (
        <div className="flex items-center justify-center gap-2 rounded-xl border bg-white p-8 text-sm text-ink-mute">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando o rateio de horas...
        </div>
      ) : (
        <>
          {/* Minidashboard */}
          <div className="grid gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-xl border bg-white p-4">
                <p className="text-[11px] uppercase tracking-wide text-ink-mute">Horas lançadas</p>
                <p className="mt-1 text-xl font-semibold text-ink font-tabular">{h(totais.lancadas)}</p>
                <p className="text-[11px] text-ink-mute">{totais.lancamentos} lançamento(s)</p>
              </div>
              <div className="rounded-xl border bg-white p-4">
                <p className="text-[11px] uppercase tracking-wide text-ink-mute">Horas cobradas</p>
                <p className="mt-1 text-xl font-semibold text-ink font-tabular">{h(totais.cobradas)}</p>
                <p className="text-[11px] text-ink-mute">aprovadas ou faturadas</p>
              </div>
              <div className="rounded-xl border bg-white p-4">
                <p className="text-[11px] uppercase tracking-wide text-ink-mute">Cut</p>
                <p className={`mt-1 text-xl font-semibold font-tabular ${cutAtual !== null && cutAtual > 0 ? 'text-red-600' : 'text-ink'}`}>
                  {formatarCut(cutAtual)}
                </p>
                <p className="text-[11px] text-ink-mute">1 − cobradas ÷ lançadas</p>
              </div>
              <div className={`rounded-xl border p-4 ${totais.emRevisao > 0 ? 'border-amber-200 bg-amber-50' : 'bg-white'}`}>
                <p className="text-[11px] uppercase tracking-wide text-ink-mute">Ainda em revisão</p>
                <p className={`mt-1 text-xl font-semibold font-tabular ${totais.emRevisao > 0 ? 'text-amber-800' : 'text-ink'}`}>
                  {h(totais.emRevisao)}
                </p>
                <p className="text-[11px] text-ink-mute">
                  {totais.emRevisao > 0
                    ? `contam como não cobradas; se forem cobradas, o cut fica em ${formatarCut(cutPiso)}`
                    : 'nada pendente: o cut do mês está fechado'}
                </p>
              </div>
            </div>
            <DonutBreakdown
              titulo="Horas cobradas por centro de custo"
              grupos={centrosCusto.map((c) => ({ label: c.nome, count: c.totais.cobradas }))}
              formatValor={h}
              maxSlices={8}
            />
          </div>

          {/* Tabela por caso */}
          <div className="overflow-x-auto rounded-xl border bg-white">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b text-[10px] uppercase tracking-wide text-ink-mute">
                  <th className="px-3 py-2 text-left">Cliente</th>
                  <th className="px-3 py-2 text-left">Caso</th>
                  <th className="px-3 py-2 text-right">Lançadas</th>
                  <th className="px-3 py-2 text-right">Cobradas</th>
                  <th className="px-3 py-2 text-right">Cut</th>
                  {centrosCusto.map((c) => (
                    <th key={c.chave} className="px-3 py-2 text-right" title={`Horas cobradas de quem é de ${c.nome}; embaixo, as lançadas`}>
                      {c.nome}
                    </th>
                  ))}
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {casos.length === 0 ? (
                  <tr>
                    <td colSpan={colunasFixas + centrosCusto.length + 1} className="px-3 py-8 text-center text-sm text-ink-mute">
                      Nenhuma hora lançada em caso por hora {temFiltro ? 'com esses filtros' : 'neste mês'}.
                    </td>
                  </tr>
                ) : (
                  casos.map((caso) => {
                    const aberto = abertos.has(caso.casoId)
                    return (
                      <Fragment key={caso.casoId}>
                        <tr className="border-b align-top text-xs hover:bg-canvas-soft/60">
                          <td className="px-3 py-2 text-ink">{caso.clienteNome}</td>
                          <td className="px-3 py-2 text-ink-secondary">{rotuloCaso(caso)}</td>
                          <td className="px-3 py-2 text-right font-tabular text-ink-secondary">{h(caso.totais.lancadas)}</td>
                          <td className="px-3 py-2 text-right font-tabular">
                            <CelulaCobradas totais={caso.totais} />
                          </td>
                          <td className="px-3 py-2 text-right font-tabular">
                            <CelulaCut totais={caso.totais} />
                          </td>
                          {centrosCusto.map((c) => {
                            const t = caso.porCentroCusto[c.chave]
                            return (
                              <td
                                key={c.chave}
                                className="px-3 py-2 text-right font-tabular"
                                title={t ? `${c.nome}: ${h(t.cobradas)} cobradas de ${h(t.lancadas)} lançadas${t.emRevisao > 0 ? ` (${h(t.emRevisao)} em revisão)` : ''}` : undefined}
                              >
                                {t ? (
                                  <div className="leading-tight">
                                    <div className="font-medium text-ink">{h(t.cobradas)}</div>
                                    <div className="text-[10px] text-ink-mute">de {h(t.lancadas)}</div>
                                  </div>
                                ) : (
                                  <span className="text-ink-mute">—</span>
                                )}
                              </td>
                            )
                          })}
                          <td className="px-3 py-2 text-right">
                            <button
                              type="button"
                              onClick={() => alternar(caso.casoId)}
                              aria-expanded={aberto}
                              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-ink-secondary hover:bg-canvas-soft hover:text-ink"
                            >
                              {aberto ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                              {aberto ? 'ver −' : 'ver +'}
                            </button>
                          </td>
                        </tr>
                        {aberto ? (
                          <tr className="border-b bg-canvas-soft/40">
                            <td colSpan={colunasFixas + centrosCusto.length + 1} className="px-3 py-3">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="text-[10px] uppercase tracking-wide text-ink-mute">
                                    <th className="px-2 py-1 text-left">Usuário</th>
                                    <th className="px-2 py-1 text-left">Centro de custo</th>
                                    <th className="px-2 py-1 text-left">Data</th>
                                    <th className="px-2 py-1 text-left">Descrição</th>
                                    <th className="px-2 py-1 text-right">Lançadas</th>
                                    <th className="px-2 py-1 text-right">Cobradas</th>
                                    <th className="px-2 py-1 text-left">Situação</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {caso.lancamentos.map((l) => (
                                    <tr key={l.timesheetId} className="border-t border-hairline align-top">
                                      <td className="px-2 py-1.5 text-ink">{l.usuarioNome}</td>
                                      <td className="px-2 py-1.5 text-ink-secondary">{nomeCentroCusto(l)}</td>
                                      <td className="px-2 py-1.5 text-ink-secondary font-tabular">{fmtData(l.dataLancamento)}</td>
                                      <td className="max-w-[420px] px-2 py-1.5 text-ink-secondary">
                                        <span className="line-clamp-3 whitespace-pre-line" title={l.descricao}>{l.descricao || '—'}</span>
                                      </td>
                                      <td className="px-2 py-1.5 text-right font-tabular text-ink-secondary">{h(l.horasLancadas)}</td>
                                      <td className="px-2 py-1.5 text-right font-tabular text-ink">{h(l.horasCobradas)}</td>
                                      <td className="px-2 py-1.5">
                                        <span
                                          className={`inline-flex rounded-full px-2 py-0.5 text-[11px] ${COR_SITUACAO[l.situacao]}`}
                                          title={ROTULO_ETAPA[l.etapa]}
                                        >
                                          {ROTULO_SITUACAO[l.situacao]}
                                        </span>
                                        {l.situacao === 'cobrada' && l.horasCobradas < l.horasLancadas ? (
                                          <span className="ml-1 text-[10px] text-red-600">corte de {h(l.horasLancadas - l.horasCobradas)}</span>
                                        ) : null}
                                        {l.situacao !== 'cobrada' ? (
                                          <span className="ml-1 text-[10px] text-ink-mute">{ROTULO_ETAPA[l.etapa]}</span>
                                        ) : null}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    )
                  })
                )}
              </tbody>
              {casos.length > 0 ? (
                <tfoot>
                  <tr className="border-t-2 border-ink/20 bg-canvas-soft text-xs font-semibold">
                    <td className="px-3 py-2 text-ink" colSpan={2}>
                      Total ({casos.length} caso{casos.length === 1 ? '' : 's'})
                    </td>
                    <td className="px-3 py-2 text-right font-tabular text-ink">{h(totais.lancadas)}</td>
                    <td className="px-3 py-2 text-right font-tabular">
                      <CelulaCobradas totais={totais} />
                    </td>
                    <td className="px-3 py-2 text-right font-tabular">
                      <CelulaCut totais={totais} />
                    </td>
                    {centrosCusto.map((c) => (
                      <td key={c.chave} className="px-3 py-2 text-right font-tabular" title={`${c.nome}: cut ${formatarCut(cut(c.totais))}`}>
                        <div className="leading-tight">
                          <div className="text-ink">{h(c.totais.cobradas)}</div>
                          <div className="text-[10px] font-normal text-ink-mute">de {h(c.totais.lancadas)}</div>
                        </div>
                      </td>
                    ))}
                    <td />
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>
        </>
      )}
    </div>
  )
}
