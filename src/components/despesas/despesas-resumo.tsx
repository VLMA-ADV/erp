'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { CommandSelect } from '@/components/ui/command-select'
import { DonutBreakdown, DONUT_PALETTE, OUTROS_COLOR } from '@/components/ui/donut-breakdown'
import { Label } from '@/components/ui/label'

/**
 * Resumo de gestao das despesas (pedido Filipe 11/08: organizar as roscas e
 * acrescentar evolucao por cliente, caso, pessoa e centro de custo).
 *
 * Le a mesma funcao da lista, entao a visibilidade e exatamente a mesma: quem so
 * enxerga as proprias despesas ve um resumo so das proprias. Toda a conta e
 * feita aqui — o volume e pequeno e uma funcao de agregacao no banco teria que
 * repetir a regra de quem ve o que, que e justamente onde erro custa caro.
 */
const MAX_FATIAS = 5

type Dimensao = 'categoria' | 'centro_custo' | 'pessoa' | 'cliente' | 'caso'

const DIMENSOES: Array<{ value: Dimensao; label: string }> = [
  { value: 'categoria', label: 'Categoria' },
  { value: 'centro_custo', label: 'Centro de custo' },
  { value: 'pessoa', label: 'Pessoa' },
  { value: 'cliente', label: 'Cliente' },
  { value: 'caso', label: 'Caso' },
]

const PERIODOS = [
  { value: '6', label: 'Últimos 6 meses' },
  { value: '12', label: 'Últimos 12 meses' },
  { value: '24', label: 'Últimos 24 meses' },
  // "Quero ver a lista em resumo de todos os lançamentos históricos"
  // (Filipe, 17/08). Antes o mais longo era 24 meses, e o que fosse mais
  // antigo simplesmente não entrava na conta.
  { value: 'tudo', label: 'Todo o período' },
]

interface Despesa {
  id: string
  cliente_id: string | null
  cliente_nome: string | null
  caso_nome: string | null
  caso_numero: number | null
  categoria: string | null
  centro_custo: string | null
  created_by_nome: string | null
  data_lancamento: string | null
  valor: number | null
  status: string | null
}

interface Fatia {
  label: string
  valor: number
  count: number
}

function formatMoney(valor: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor || 0)
}

function formatMoneyCurto(valor: number) {
  if (Math.abs(valor) >= 1000) {
    return `R$ ${(valor / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}k`
  }
  return formatMoney(valor)
}

function chaveDoMes(data: Date) {
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}`
}

function rotuloDoMes(chave: string) {
  const [ano, mes] = chave.split('-')
  const data = new Date(Number(ano), Number(mes) - 1, 1)
  return data.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')
}

function valorDaDimensao(item: Despesa, dimensao: Dimensao): string {
  switch (dimensao) {
    case 'categoria':
      return item.categoria || 'Sem categoria'
    case 'centro_custo':
      return item.centro_custo || 'Sem centro de custo'
    case 'pessoa':
      return (item.created_by_nome || '').trim() || 'Sem responsável'
    case 'cliente':
      return item.cliente_nome || 'Sem cliente'
    case 'caso':
      return `${item.caso_numero ? `${item.caso_numero} - ` : ''}${item.caso_nome || 'Sem caso'}`
  }
}

function agrupar(itens: Despesa[], dimensao: Dimensao): Fatia[] {
  const mapa = new Map<string, Fatia>()
  for (const item of itens) {
    const label = valorDaDimensao(item, dimensao)
    const atual = mapa.get(label) || { label, valor: 0, count: 0 }
    atual.valor += Number(item.valor || 0)
    atual.count += 1
    mapa.set(label, atual)
  }
  return Array.from(mapa.values()).sort((a, b) => b.valor - a.valor)
}

/** Top N + "Outros", que e como as roscas e a evolucao empilhada leem melhor. */
function topoComOutros(fatias: Fatia[], maximo = MAX_FATIAS): Fatia[] {
  if (fatias.length <= maximo) return fatias
  const cabeca = fatias.slice(0, maximo)
  const resto = fatias.slice(maximo)
  return [
    ...cabeca,
    {
      label: 'Outros',
      valor: resto.reduce((soma, f) => soma + f.valor, 0),
      count: resto.reduce((soma, f) => soma + f.count, 0),
    },
  ]
}

function corDaFatia(label: string, indice: number) {
  return label === 'Outros' ? OUTROS_COLOR : DONUT_PALETTE[indice % DONUT_PALETTE.length]
}

function KpiCard({ label, valor, count }: { label: string; valor: number; count: number }) {
  return (
    <div className="rounded-lg border border-hairline bg-white p-4">
      <p className="text-eyebrow">{label}</p>
      <p className="mt-1 text-2xl font-light text-ink">{formatMoney(valor)}</p>
      <p className="mt-1 text-xs text-ink-mute">{count} lançamento{count === 1 ? '' : 's'}</p>
    </div>
  )
}

function Ranking({ titulo, fatias }: { titulo: string; fatias: Fatia[] }) {
  const maior = Math.max(1, ...fatias.map((f) => f.valor))
  return (
    <div className="rounded-xl border border-hairline bg-card p-4">
      <p className="text-eyebrow mb-3">{titulo}</p>
      {fatias.length === 0 ? (
        <p className="text-sm text-ink-mute">Sem lançamentos no período</p>
      ) : (
        <ul className="space-y-2">
          {fatias.slice(0, 8).map((fatia) => (
            <li key={fatia.label} className="text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-ink-secondary">{fatia.label}</span>
                <span className="shrink-0 font-tabular text-ink">
                  {formatMoney(fatia.valor)} <span className="text-ink-mute">· {fatia.count}</span>
                </span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-secondary">
                <div className="h-1.5 rounded-full bg-primary" style={{ width: `${(fatia.valor / maior) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function DespesasResumo() {
  const [itens, setItens] = useState<Despesa[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  const [meses, setMeses] = useState('12')
  const [clienteId, setClienteId] = useState('')
  const [dimensao, setDimensao] = useState<Dimensao>('centro_custo')

  useEffect(() => {
    const carregar = async () => {
      try {
        const supabase = createClient()
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) return

        const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
        const resposta = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-despesas`, {
          method: 'GET',
          cache: 'no-store',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            ...(anonKey ? { apikey: anonKey } : {}),
            'Content-Type': 'application/json',
          },
        })
        const payload = await resposta.json().catch(() => ({}))
        if (!resposta.ok) {
          setErro(payload.error || 'Erro ao carregar o resumo')
          return
        }
        setItens((Array.isArray(payload.data) ? payload.data : []) as Despesa[])
      } catch (err) {
        console.error(err)
        setErro('Erro ao carregar o resumo')
      } finally {
        setCarregando(false)
      }
    }
    void carregar()
  }, [])

  const clienteOptions = useMemo(() => {
    const unicos = new Map<string, string>()
    for (const item of itens) {
      if (item.cliente_id && !unicos.has(item.cliente_id)) {
        unicos.set(item.cliente_id, item.cliente_nome || 'Cliente sem nome')
      }
    }
    return [
      { value: '', label: 'Todos os clientes' },
      ...Array.from(unicos.entries())
        .map(([value, label]) => ({ value, label }))
        .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR')),
    ]
  }, [itens])

  const chavesDoPeriodo = useMemo(() => {
    const hoje = new Date()
    // "Todo o período" vai do mês da despesa mais antiga até hoje, e não uma
    // janela fixa: a série do gráfico precisa de todos os meses no meio, senão
    // um mês sem lançamento vira um buraco na linha em vez de um zero.
    let total = Number(meses)
    if (meses === 'tudo') {
      const datas = itens.map((i) => i.data_lancamento).filter((d): d is string => Boolean(d)).sort()
      const maisAntiga = datas[0]
      if (!maisAntiga) return [chaveDoMes(hoje)]
      const [ano, mes] = maisAntiga.split('-').map(Number)
      total = (hoje.getFullYear() - ano) * 12 + (hoje.getMonth() + 1 - mes) + 1
    }
    const chaves: string[] = []
    for (let i = total - 1; i >= 0; i--) {
      chaves.push(chaveDoMes(new Date(hoje.getFullYear(), hoje.getMonth() - i, 1)))
    }
    return chaves
  }, [meses, itens])

  // Cancelado nao e gasto: some das contas, como ja some da lista.
  const doPeriodo = useMemo(() => {
    const dentro = new Set(chavesDoPeriodo)
    return itens.filter((item) => {
      if (item.status === 'cancelado') return false
      if (clienteId && item.cliente_id !== clienteId) return false
      if (!item.data_lancamento) return false
      return dentro.has(item.data_lancamento.slice(0, 7))
    })
  }, [itens, chavesDoPeriodo, clienteId])

  const kpis = useMemo(() => {
    const hoje = new Date()
    const iso = (data: Date) => data.toISOString().slice(0, 10)
    const hojeIso = iso(hoje)
    const inicioSemana = new Date(hoje)
    inicioSemana.setDate(hoje.getDate() - hoje.getDay())
    const inicioSemanaIso = iso(inicioSemana)
    const mesAtual = chaveDoMes(hoje)

    const somar = (filtro: (item: Despesa) => boolean) => {
      const lista = doPeriodo.filter(filtro)
      return { valor: lista.reduce((soma, item) => soma + Number(item.valor || 0), 0), count: lista.length }
    }

    return {
      hoje: somar((item) => item.data_lancamento === hojeIso),
      semana: somar((item) => (item.data_lancamento || '') >= inicioSemanaIso && (item.data_lancamento || '') <= hojeIso),
      mes: somar((item) => (item.data_lancamento || '').slice(0, 7) === mesAtual),
      total: somar(() => true),
    }
  }, [doPeriodo])

  // Evolucao empilhada: as fatias sao as mesmas em todos os meses, senao a cor
  // trocaria de dono de um mes para o outro e o grafico mentiria.
  const evolucao = useMemo(() => {
    const fatias = topoComOutros(agrupar(doPeriodo, dimensao))
    const rotulos = fatias.map((f) => f.label)
    const noTopo = new Set(rotulos.filter((r) => r !== 'Outros'))

    const porMes = chavesDoPeriodo.map((chave) => {
      const doMes = doPeriodo.filter((item) => (item.data_lancamento || '').slice(0, 7) === chave)
      const segmentos = rotulos.map((rotulo) => {
        const pertence = (item: Despesa) => {
          const label = valorDaDimensao(item, dimensao)
          return rotulo === 'Outros' ? !noTopo.has(label) : label === rotulo
        }
        return { label: rotulo, valor: doMes.filter(pertence).reduce((s, i) => s + Number(i.valor || 0), 0) }
      })
      return { chave, total: segmentos.reduce((s, seg) => s + seg.valor, 0), segmentos }
    })

    return { rotulos, porMes, maior: Math.max(1, ...porMes.map((m) => m.total)) }
  }, [doPeriodo, chavesDoPeriodo, dimensao])

  if (carregando) {
    return (
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[1, 2, 3, 4].map((i) => <div key={i} className="h-24 animate-pulse rounded-lg bg-secondary" />)}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {erro ? <p className="text-sm text-destructive">{erro}</p> : null}

      <div className="grid grid-cols-1 gap-3 rounded-md border bg-muted/20 p-3 md:grid-cols-3">
        <div className="space-y-1">
          <Label>Período</Label>
          <CommandSelect value={meses} onValueChange={setMeses} options={PERIODOS} placeholder="Período" />
        </div>
        <div className="space-y-1">
          <Label>Cliente</Label>
          <CommandSelect
            value={clienteId}
            onValueChange={setClienteId}
            options={clienteOptions}
            placeholder="Todos os clientes"
            searchPlaceholder="Buscar cliente..."
            emptyText="Nenhum cliente encontrado."
          />
        </div>
        <div className="space-y-1">
          <Label>Evolução por</Label>
          <CommandSelect
            value={dimensao}
            onValueChange={(valor) => setDimensao(valor as Dimensao)}
            options={DIMENSOES}
            placeholder="Dimensão"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Hoje" valor={kpis.hoje.valor} count={kpis.hoje.count} />
        <KpiCard label="Esta semana" valor={kpis.semana.valor} count={kpis.semana.count} />
        <KpiCard label="Este mês" valor={kpis.mes.valor} count={kpis.mes.count} />
        <KpiCard label="Total no período" valor={kpis.total.valor} count={kpis.total.count} />
      </div>

      <div className="rounded-xl border border-hairline bg-card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-eyebrow">
            Evolução por {DIMENSOES.find((d) => d.value === dimensao)?.label.toLowerCase()}
          </p>
          <ul className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {evolucao.rotulos.map((rotulo, indice) => (
              <li key={rotulo} className="flex items-center gap-1.5 text-xs text-ink-secondary">
                <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: corDaFatia(rotulo, indice) }} />
                <span className="max-w-[180px] truncate">{rotulo}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex items-end gap-2 overflow-x-auto">
          {evolucao.porMes.map((mes) => (
            <div key={mes.chave} className="flex min-w-[44px] flex-1 flex-col items-center gap-1">
              <span className="font-tabular text-[11px] text-ink-mute">
                {mes.total > 0 ? formatMoneyCurto(mes.total) : '—'}
              </span>
              <div className="flex h-32 w-full flex-col-reverse">
                {mes.segmentos.map((segmento, indice) =>
                  segmento.valor > 0 ? (
                    <div
                      key={segmento.label}
                      className="w-full"
                      style={{
                        height: `${(segmento.valor / evolucao.maior) * 100}%`,
                        background: corDaFatia(segmento.label, indice),
                      }}
                      title={`${rotuloDoMes(mes.chave)} · ${segmento.label}: ${formatMoney(segmento.valor)}`}
                    />
                  ) : null,
                )}
              </div>
              <span className="text-xs capitalize text-ink-secondary">{rotuloDoMes(mes.chave)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <DonutBreakdown
          titulo="Por categoria"
          grupos={topoComOutros(agrupar(doPeriodo, 'categoria')).map((f) => ({ label: f.label, count: f.valor }))}
          formatValor={formatMoney}
        />
        <DonutBreakdown
          titulo="Por centro de custo"
          grupos={topoComOutros(agrupar(doPeriodo, 'centro_custo')).map((f) => ({ label: f.label, count: f.valor }))}
          formatValor={formatMoney}
        />
        <DonutBreakdown
          titulo="Por pessoa"
          grupos={topoComOutros(agrupar(doPeriodo, 'pessoa')).map((f) => ({ label: f.label, count: f.valor }))}
          formatValor={formatMoney}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Ranking titulo="Por cliente" fatias={agrupar(doPeriodo, 'cliente')} />
        <Ranking titulo="Por caso" fatias={agrupar(doPeriodo, 'caso')} />
      </div>
    </div>
  )
}
