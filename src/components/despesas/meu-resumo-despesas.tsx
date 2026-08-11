'use client'

import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

/**
 * Mini resumo da propria pessoa (pedido Filipe 11/08): evolucao do quanto ela
 * lancou e onde ela mais lanca. Nao e o Resumo da aba ao lado, que e a visao de
 * gestao — aqui e sempre so o que a pessoa lancou.
 *
 * Le a mesma funcao da lista, sem filtro de data, e recorta pelo created_by. Nao
 * cria nada no banco: o volume por pessoa e pequeno e nao compensa uma funcao
 * nova so para somar.
 */
const MESES_NO_GRAFICO = 6
const TOPO = 5

interface DespesaResumo {
  created_by: string | null
  data_lancamento: string | null
  valor: number | null
  categoria: string | null
  cliente_nome: string | null
  caso_nome: string | null
  caso_numero: number | null
}

interface Fatia {
  label: string
  valor: number
  count: number
}

function formatMoney(valor: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor || 0)
}

function chaveDoMes(data: Date) {
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}`
}

function rotuloDoMes(chave: string) {
  const [ano, mes] = chave.split('-')
  const data = new Date(Number(ano), Number(mes) - 1, 1)
  return data.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')
}

function agrupar(itens: DespesaResumo[], chave: (item: DespesaResumo) => string): Fatia[] {
  const mapa = new Map<string, Fatia>()
  for (const item of itens) {
    const label = chave(item).trim() || 'Sem informação'
    const atual = mapa.get(label) || { label, valor: 0, count: 0 }
    atual.valor += Number(item.valor || 0)
    atual.count += 1
    mapa.set(label, atual)
  }
  return Array.from(mapa.values()).sort((a, b) => b.valor - a.valor).slice(0, TOPO)
}

function Topo({ titulo, fatias }: { titulo: string; fatias: Fatia[] }) {
  const maior = Math.max(1, ...fatias.map((f) => f.valor))
  return (
    <div className="rounded-lg border border-hairline bg-white p-4">
      <p className="text-eyebrow mb-3">{titulo}</p>
      {fatias.length === 0 ? (
        <p className="text-sm text-ink-mute">Você ainda não lançou nada aqui.</p>
      ) : (
        <ul className="space-y-2">
          {fatias.map((fatia) => (
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

export default function MeuResumoDespesas() {
  const [itens, setItens] = useState<DespesaResumo[]>([])
  const [carregando, setCarregando] = useState(true)
  const [aberto, setAberto] = useState(true)

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
        if (!resposta.ok) return

        const lista = (Array.isArray(payload.data) ? payload.data : []) as DespesaResumo[]
        setItens(lista.filter((item) => item.created_by === session.user.id))
      } catch (err) {
        console.error(err)
      } finally {
        setCarregando(false)
      }
    }
    void carregar()
  }, [])

  const meses = useMemo(() => {
    const chaves: string[] = []
    const hoje = new Date()
    for (let i = MESES_NO_GRAFICO - 1; i >= 0; i--) {
      chaves.push(chaveDoMes(new Date(hoje.getFullYear(), hoje.getMonth() - i, 1)))
    }
    const totais = new Map<string, number>(chaves.map((chave) => [chave, 0]))
    for (const item of itens) {
      if (!item.data_lancamento) continue
      const chave = item.data_lancamento.slice(0, 7)
      if (!totais.has(chave)) continue
      totais.set(chave, (totais.get(chave) || 0) + Number(item.valor || 0))
    }
    return chaves.map((chave) => ({ chave, valor: totais.get(chave) || 0 }))
  }, [itens])

  const totalDoPeriodo = useMemo(() => meses.reduce((soma, mes) => soma + mes.valor, 0), [meses])
  const maiorMes = Math.max(1, ...meses.map((mes) => mes.valor))

  const porCliente = useMemo(() => agrupar(itens, (item) => item.cliente_nome || ''), [itens])
  const porCaso = useMemo(
    () => agrupar(itens, (item) => (item.caso_numero ? `${item.caso_numero} - ` : '') + (item.caso_nome || '')),
    [itens],
  )
  const porCategoria = useMemo(() => agrupar(itens, (item) => item.categoria || ''), [itens])

  if (carregando) return <div className="h-32 animate-pulse rounded-lg bg-secondary" />
  if (itens.length === 0) return null

  return (
    <section className="rounded-lg border border-hairline bg-canvas-soft/40">
      <button
        type="button"
        onClick={() => setAberto((prev) => !prev)}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
        aria-expanded={aberto}
      >
        <span className="text-sm font-medium text-ink">
          Meu resumo
          <span className="ml-2 font-normal text-ink-mute">
            {formatMoney(totalDoPeriodo)} nos últimos {MESES_NO_GRAFICO} meses · {itens.length} lançamento
            {itens.length > 1 ? 's' : ''}
          </span>
        </span>
        {aberto ? <ChevronUp className="h-4 w-4 text-ink-mute" /> : <ChevronDown className="h-4 w-4 text-ink-mute" />}
      </button>

      {aberto ? (
        <div className="space-y-3 border-t border-hairline p-4">
          <div className="rounded-lg border border-hairline bg-white p-4">
            <p className="text-eyebrow mb-3">Evolução dos seus lançamentos</p>
            <div className="flex items-end gap-3">
              {meses.map((mes) => (
                <div key={mes.chave} className="flex flex-1 flex-col items-center gap-1">
                  <span className="font-tabular text-[11px] text-ink-mute">
                    {mes.valor > 0 ? formatMoney(mes.valor) : '—'}
                  </span>
                  <div className="flex h-24 w-full items-end">
                    <div
                      className="w-full rounded-t bg-primary"
                      style={{ height: `${Math.max(mes.valor > 0 ? 4 : 0, (mes.valor / maiorMes) * 100)}%` }}
                    />
                  </div>
                  <span className="text-xs capitalize text-ink-secondary">{rotuloDoMes(mes.chave)}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Topo titulo="Clientes que você mais lança" fatias={porCliente} />
            <Topo titulo="Casos que você mais lança" fatias={porCaso} />
            <Topo titulo="Categorias que você mais usa" fatias={porCategoria} />
          </div>
        </div>
      ) : null}
    </section>
  )
}
