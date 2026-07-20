'use client'

// Indicadores do CRM conforme mock do cliente (20/07): KPIs, funil de
// conversão CLICÁVEL (filtra os painéis de baixo), contratos fechados por
// mês, valor por área, performance por responsável e temperatura do funil.
import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

interface CardItem {
  id: string
  cliente_nome?: string | null
  valor: number
  etapa: string
  temperatura_pct?: number | null
  responsavel_interno_nome?: string | null
  area_id?: string | null
  produto_nome?: string | null
  servico_nome?: string | null
  estado?: string | null
  data_card?: string | null
  created_at?: string | null
  updated_at?: string | null
  ativo?: boolean | null
}
interface AreaItem { id: string; nome: string }

const ETAPAS_FUNIL: Array<{ key: string; label: string; cor: string }> = [
  { key: 'prospeccao', label: 'Prospecção', cor: '#6B7280' },
  { key: 'em_standby', label: 'Em standby', cor: '#9CA3AF' },
  { key: 'proposta_solicitada', label: 'Proposta solicitada', cor: '#2563EB' },
  { key: 'proposta_enviada', label: 'Proposta enviada', cor: '#7C3AED' },
  { key: 'exito_projetado', label: 'Êxito projetado', cor: '#B45309' },
  { key: 'conversao', label: 'Conversão', cor: '#059669' },
]
const ETAPAS_ABERTAS = ['prospeccao', 'em_standby', 'proposta_solicitada', 'proposta_enviada', 'exito_projetado']
const DONUT_CORES = ['#B45309', '#059669', '#2563EB', '#7C3AED', '#E8871E', '#DB2777', '#0891B2', '#6B7280']
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

const money = (v: number | null | undefined) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(Number(v || 0))
const moneyCompact = (v: number) => {
  if (Math.abs(v) >= 1_000_000) return `R$ ${(v / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}M`
  if (Math.abs(v) >= 1_000) return `R$ ${Math.round(v / 1_000)}k`
  return money(v)
}

function Donut({ fatias, centro, sub }: { fatias: Array<{ valor: number; cor: string }>; centro: string; sub: string }) {
  const total = Math.max(1, fatias.reduce((s, f) => s + f.valor, 0))
  let acc = 0
  const stops = fatias
    .filter((f) => f.valor > 0)
    .map((f) => {
      const de = (acc / total) * 360
      acc += f.valor
      const ate = (acc / total) * 360
      return `${f.cor} ${de.toFixed(1)}deg ${ate.toFixed(1)}deg`
    })
    .join(', ')
  return (
    <div className="relative h-28 w-28 shrink-0">
      <div className="h-full w-full rounded-full" style={{ background: stops ? `conic-gradient(${stops})` : '#f3f4f6' }} />
      <div className="absolute inset-3 flex flex-col items-center justify-center rounded-full bg-white text-center">
        <span className="text-sm font-semibold leading-tight text-ink">{centro}</span>
        <span className="text-[9px] uppercase tracking-wide text-ink-mute">{sub}</span>
      </div>
    </div>
  )
}

export default function CrmDashboard() {
  const [cards, setCards] = useState<CardItem[]>([])
  const [areas, setAreas] = useState<AreaItem[]>([])
  const [loading, setLoading] = useState(true)
  const [etapaSel, setEtapaSel] = useState<string | null>(null)

  useEffect(() => {
    const load = async () => {
      try {
        const supabase = createClient()
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) return
        const headers = {
          Authorization: `Bearer ${session.access_token}`,
          ...(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY } : {}),
          'Content-Type': 'application/json',
        }
        const [cardsRes, areasRes] = await Promise.all([
          fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-crm-pipeline?_ts=${Date.now()}`, { headers, cache: 'no-store' }),
          fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-areas?_ts=${Date.now()}`, { headers, cache: 'no-store' }),
        ])
        const cardsPayload = await cardsRes.json().catch(() => ({}))
        const areasPayload = await areasRes.json().catch(() => ({}))
        if (cardsRes.ok) {
          const lista = (cardsPayload.data || []) as CardItem[]
          setCards(lista.filter((c) => c.ativo !== false))
        }
        if (areasRes.ok) setAreas(((areasPayload.data || []) as AreaItem[]))
      } catch (err) {
        console.error(err)
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [])

  const calc = useMemo(() => {
    const abertos = cards.filter((c) => ETAPAS_ABERTAS.includes(c.etapa))
    const convertidos = cards.filter((c) => c.etapa === 'conversao')
    const encerrados = cards.filter((c) => ['negada', 'suspensa'].includes(c.etapa))

    const agora = new Date()
    const inicioMes = new Date(agora.getFullYear(), agora.getMonth(), 1)
    const novasMes = abertos.filter((c) => {
      const d = c.created_at ? new Date(c.created_at) : null
      return d && d >= inicioMes
    }).length

    const valorFunil = abertos.reduce((s, c) => s + Number(c.valor || 0), 0)
    const totalCriados = abertos.length + convertidos.length + encerrados.length
    const taxaConversao = totalCriados ? Math.round((convertidos.length / totalCriados) * 100) : 0
    const ticketMedio = abertos.length ? valorFunil / abertos.length : 0

    const ciclos = convertidos
      .map((c) => {
        const ini = c.data_card || c.created_at
        const fim = c.updated_at
        if (!ini || !fim) return null
        const dias = (new Date(fim).getTime() - new Date(ini).getTime()) / 86_400_000
        return dias >= 0 ? dias : null
      })
      .filter((d): d is number => d !== null)
    const cicloMedio = ciclos.length ? Math.round(ciclos.reduce((s, d) => s + d, 0) / ciclos.length) : null

    const funil = ETAPAS_FUNIL.map((etapa) => {
      const itens = cards.filter((c) => c.etapa === etapa.key)
      return { ...etapa, count: itens.length, valor: itens.reduce((s, c) => s + Number(c.valor || 0), 0) }
    })
    const maxFunil = Math.max(1, ...funil.map((f) => f.count))

    const fechadosPorMes = MESES.map((mes, i) => {
      const doMes = convertidos.filter((c) => {
        const d = c.updated_at ? new Date(c.updated_at) : null
        return d && d.getFullYear() === agora.getFullYear() && d.getMonth() === i
      })
      return { mes, valor: doMes.reduce((s, c) => s + Number(c.valor || 0), 0), count: doMes.length }
    })

    return { abertos, convertidos, novasMes, valorFunil, taxaConversao, ticketMedio, cicloMedio, funil, maxFunil, fechadosPorMes }
  }, [cards])

  // Painéis de baixo respeitam a etapa clicada no funil.
  const filtrados = useMemo(() => {
    const base = etapaSel ? cards.filter((c) => c.etapa === etapaSel) : calc.abertos
    const grupo = (chave: (c: CardItem) => string) => {
      const m = new Map<string, { label: string; count: number; valor: number }>()
      for (const c of base) {
        const k = chave(c)
        const atual = m.get(k) || { label: k, count: 0, valor: 0 }
        atual.count += 1
        atual.valor += Number(c.valor || 0)
        m.set(k, atual)
      }
      return Array.from(m.values()).sort((a, b) => b.valor - a.valor)
    }
    const areaNome = new Map(areas.map((a) => [a.id, a.nome]))
    return {
      base,
      total: base.reduce((s, c) => s + Number(c.valor || 0), 0),
      porArea: grupo((c) => (c.area_id && areaNome.get(c.area_id)) || 'Sem centro de custo'),
      porResponsavel: grupo((c) => c.responsavel_interno_nome || 'Sem responsável'),
    }
  }, [cards, calc.abertos, etapaSel, areas])

  const temperatura = useMemo(() => {
    const base = filtrados.base
    const faixa = (min: number, max: number) =>
      base.filter((c) => c.temperatura_pct != null && Number(c.temperatura_pct) > 0 && Number(c.temperatura_pct) >= min && Number(c.temperatura_pct) <= max)
    const resumo = (itens: CardItem[]) => ({ count: itens.length, valor: itens.reduce((s, c) => s + Number(c.valor || 0), 0) })
    const quente = resumo(faixa(67, 100))
    const morna = resumo(faixa(34, 66))
    const fria = resumo(faixa(1, 33))
    const semTemp = resumo(base.filter((c) => c.temperatura_pct == null || Number(c.temperatura_pct) === 0))
    return { quente, morna, fria, semTemp, classificadas: quente.count + morna.count + fria.count }
  }, [filtrados])

  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {[1, 2, 3, 4, 5].map((i) => <div key={i} className="h-28 animate-pulse rounded-xl bg-secondary" />)}
      </div>
    )
  }

  const kpis = [
    { label: 'Oportunidades ativas', valor: String(calc.abertos.length), sub: calc.novasMes ? `▲ ${calc.novasMes} nova(s) no mês` : 'no funil', subVerde: calc.novasMes > 0 },
    { label: 'Valor no funil', valor: moneyCompact(calc.valorFunil), sub: 'soma das oportunidades' },
    { label: 'Taxa de conversão', valor: `${calc.taxaConversao}%`, sub: 'prospecção → conversão', destaque: true },
    { label: 'Ticket médio', valor: moneyCompact(calc.ticketMedio), sub: 'por oportunidade' },
    { label: 'Ciclo médio', valor: calc.cicloMedio != null ? `${calc.cicloMedio} dias` : '—', sub: 'da prospecção ao fechamento' },
  ]

  const maxFechado = Math.max(1, ...calc.fechadosPorMes.map((m) => m.valor))
  const etapaSelLabel = ETAPAS_FUNIL.find((e) => e.key === etapaSel)?.label

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-xl border border-hairline bg-white p-4">
            <p className="text-eyebrow">{k.label}</p>
            <p className={`mt-1 text-2xl font-light ${k.destaque ? 'text-emerald-700' : 'text-ink'}`}>{k.valor}</p>
            <p className={`mt-1 text-xs ${k.subVerde ? 'text-emerald-600' : 'text-ink-mute'}`}>{k.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-hairline bg-white p-4">
          <p className="text-sm font-semibold text-ink">Funil de conversão</p>
          <p className="mb-4 text-xs text-ink-mute">
            Oportunidades e valor por etapa · % em relação à etapa anterior · <span className="font-medium text-ink-secondary">clique numa etapa para filtrar os painéis abaixo</span>
          </p>
          <div className="space-y-2">
            {calc.funil.map((f, i) => {
              const anterior = i > 0 ? calc.funil[i - 1] : null
              const pct = anterior && anterior.count > 0 ? Math.round((f.count / anterior.count) * 100) : 100
              const largura = Math.max(18, (f.count / calc.maxFunil) * 100)
              const ativo = etapaSel === f.key
              return (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setEtapaSel((prev) => (prev === f.key ? null : f.key))}
                  className="group flex w-full items-center gap-2 text-left"
                  title={ativo ? 'Clique para limpar o filtro' : `Filtrar por ${f.label}`}
                >
                  <span className="w-36 shrink-0 truncate text-xs text-ink-secondary">{f.label}</span>
                  <span className="flex flex-1 justify-center">
                    <span
                      className={`flex items-center justify-center gap-2 rounded-lg px-3 py-1.5 text-[11px] font-medium text-white transition ${ativo ? 'ring-2 ring-offset-1 ring-[#E8871E]' : 'group-hover:opacity-85'}`}
                      style={{ width: `${largura}%`, minWidth: 120, backgroundColor: f.cor }}
                    >
                      <span className="font-semibold">{f.count}</span>
                      <span className="opacity-85">{moneyCompact(f.valor)}</span>
                    </span>
                  </span>
                  <span className={`w-10 shrink-0 text-right text-xs font-medium ${pct >= 70 ? 'text-emerald-600' : 'text-amber-600'}`}>
                    {i === 0 ? '100%' : `${pct}%`}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        <div className="rounded-xl border border-hairline bg-white p-4">
          <p className="text-sm font-semibold text-ink">Novos contratos fechados</p>
          <p className="mb-4 text-xs text-ink-mute">Valor convertido por mês · {new Date().getFullYear()}</p>
          <div className="flex h-48 items-end gap-2">
            {calc.fechadosPorMes.map((m, i) => {
              const atual = i === new Date().getMonth()
              return (
                <div key={m.mes} className="flex flex-1 flex-col items-center justify-end gap-1" title={`${m.mes}: ${m.count} conversão(ões) · ${money(m.valor)}`}>
                  {m.valor > 0 ? (
                    <span className="text-[9px] font-semibold text-[#B45309]">{moneyCompact(m.valor)}</span>
                  ) : null}
                  <div
                    className="w-full rounded-t"
                    style={{
                      height: `${Math.max(m.valor > 0 ? 8 : 2, (m.valor / maxFechado) * 130)}px`,
                      backgroundColor: m.valor > 0 ? (atual ? '#E8871E' : '#F5CBA0') : '#F3F4F6',
                    }}
                  />
                  <span className="text-[9px] uppercase text-ink-mute">{m.mes}</span>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {etapaSel ? (
        <p className="rounded-lg border border-[#E8871E]/40 bg-[#FFF7ED] px-3 py-2 text-xs text-ink-secondary">
          Painéis abaixo filtrados pela etapa <strong>{etapaSelLabel}</strong> ({filtrados.base.length} oportunidade(s) · {money(filtrados.total)}).{' '}
          <button type="button" className="font-medium text-[#B45309] underline" onClick={() => setEtapaSel(null)}>Limpar filtro</button>
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-hairline bg-white p-4">
          <p className="text-sm font-semibold text-ink">Valor por área de atuação</p>
          <p className="mb-3 text-xs text-ink-mute">Participação no funil{etapaSel ? ` · ${etapaSelLabel}` : ''}</p>
          <div className="flex items-start gap-4">
            <Donut
              fatias={filtrados.porArea.map((g, i) => ({ valor: g.valor, cor: DONUT_CORES[i % DONUT_CORES.length] }))}
              centro={moneyCompact(filtrados.total)}
              sub="no funil"
            />
            <ul className="min-w-0 flex-1 space-y-1.5">
              {filtrados.porArea.slice(0, 7).map((g, i) => (
                <li key={g.label} className="flex items-center gap-2 text-xs">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: DONUT_CORES[i % DONUT_CORES.length] }} />
                  <span className="min-w-0 flex-1 truncate text-ink-secondary" title={g.label}>{g.label}</span>
                  <span className="shrink-0 font-tabular font-medium text-ink">{moneyCompact(g.valor)}</span>
                  <span className="w-8 shrink-0 text-right text-ink-mute">{Math.round((g.valor / Math.max(filtrados.total, 1)) * 100)}%</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="rounded-xl border border-hairline bg-white p-4">
          <p className="text-sm font-semibold text-ink">Performance por responsável</p>
          <p className="mb-3 text-xs text-ink-mute">Valor no funil por advogado(a){etapaSel ? ` · ${etapaSelLabel}` : ''}</p>
          <div className="flex items-start gap-4">
            <Donut
              fatias={filtrados.porResponsavel.map((g, i) => ({ valor: g.valor, cor: DONUT_CORES[(i + 4) % DONUT_CORES.length] }))}
              centro={String(filtrados.porResponsavel.length)}
              sub="pessoas"
            />
            <ul className="min-w-0 flex-1 space-y-2">
              {filtrados.porResponsavel.slice(0, 6).map((g, i) => {
                const max = Math.max(1, ...filtrados.porResponsavel.map((x) => x.valor))
                return (
                  <li key={g.label} className="text-xs">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: DONUT_CORES[(i + 4) % DONUT_CORES.length] }} />
                      <span className="min-w-0 flex-1 truncate font-medium text-ink" title={g.label}>{g.label}</span>
                      <span className="shrink-0 font-tabular text-ink">{moneyCompact(g.valor)}</span>
                      <span className="shrink-0 text-ink-mute">· {g.count} ops</span>
                    </div>
                    <div className="mt-1 h-1 rounded-full bg-secondary">
                      <div className="h-1 rounded-full" style={{ width: `${(g.valor / max) * 100}%`, backgroundColor: DONUT_CORES[(i + 4) % DONUT_CORES.length] }} />
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
        </div>

        <div className="rounded-xl border border-hairline bg-white p-4">
          <p className="text-sm font-semibold text-ink">Temperatura do funil</p>
          <p className="mb-3 text-xs text-ink-mute">Probabilidade de fechamento{etapaSel ? ` · ${etapaSelLabel}` : ''}</p>
          <div className="flex items-start gap-4">
            <Donut
              fatias={[
                { valor: temperatura.quente.count, cor: '#DC2626' },
                { valor: temperatura.morna.count, cor: '#E8871E' },
                { valor: temperatura.fria.count, cor: '#2563EB' },
              ]}
              centro={String(temperatura.classificadas)}
              sub="classificadas"
            />
            <div className="min-w-0 flex-1 space-y-2 text-xs">
              {[
                { label: 'Quente (67–100%)', cor: '#DC2626', dados: temperatura.quente },
                { label: 'Morna (34–66%)', cor: '#E8871E', dados: temperatura.morna },
                { label: 'Fria (0–33%)', cor: '#2563EB', dados: temperatura.fria },
              ].map((t) => {
                const max = Math.max(1, temperatura.quente.count, temperatura.morna.count, temperatura.fria.count)
                return (
                  <div key={t.label}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium" style={{ color: t.cor }}>{t.label}</span>
                      <span className="shrink-0 text-ink-secondary">{t.dados.count} ops · {moneyCompact(t.dados.valor)}</span>
                    </div>
                    <div className="mt-1 h-1.5 rounded-full bg-secondary">
                      <div className="h-1.5 rounded-full" style={{ width: `${(t.dados.count / max) * 100}%`, backgroundColor: t.cor }} />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
          {temperatura.semTemp.count > 0 ? (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
              ⚠ {temperatura.semTemp.count} oportunidade(s) ({moneyCompact(temperatura.semTemp.valor)}) sem temperatura definida — classifique para melhorar a previsão.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}
