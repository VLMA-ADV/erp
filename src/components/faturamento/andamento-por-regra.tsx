'use client'

import { useState, type KeyboardEvent } from 'react'

// Painel "Andamento por regra de cobranca" da Revisao de fatura.
// Filipe, 10/09: "quero ver valor e quantidade de itens, porque quero saber
// quais itens ainda precisam de providencia (revisao etc)". Os dados vem da
// propria tela e a coluna "Faturado no mes" vem do banco, porque item
// faturado sai da fila quando a nota e emitida.
//
// Desde 21/09 o painel fica na tela inicial e e clicavel (D7=a): clicar em
// regra/etapa filtra a lista abaixo, mas o painel continua mostrando o total
// (obedece so a centro de custo e usuario) — e o mapa, nao a lista.

export type EtapaKey = 'liberado' | 'revisado' | 'aprovado' | 'faturado'

export type StatusFila = 'em_revisao' | 'em_aprovacao' | 'aprovado' | 'faturado'

export interface AndamentoLinha {
  key: string
  label: string
  itens: Record<EtapaKey, number>
  valor: Record<EtapaKey, number>
}

export interface FaturadoMes {
  key: string
  itens: number
  valor: number
}

export interface AndamentoSelecao {
  regra: string | null
  etapa: EtapaKey | null
}

const ETAPAS: Array<{ key: EtapaKey; label: string; cor: string }> = [
  { key: 'liberado', label: 'Liberado', cor: 'bg-amber-400' },
  { key: 'revisado', label: 'Revisado', cor: 'bg-sky-400' },
  { key: 'aprovado', label: 'Aprovado', cor: 'bg-emerald-500' },
  { key: 'faturado', label: 'Faturado', cor: 'bg-ink' },
]

export function etapaDoStatus(status: string): EtapaKey | null {
  if (status === 'em_revisao') return 'liberado'
  if (status === 'em_aprovacao') return 'revisado'
  if (status === 'aprovado') return 'aprovado'
  if (status === 'faturado') return 'faturado'
  return null
}

// Inverso de etapaDoStatus: a etapa clicada no painel vira o filtro de situacao.
export function statusDaEtapa(etapa: EtapaKey): StatusFila {
  if (etapa === 'liberado') return 'em_revisao'
  if (etapa === 'revisado') return 'em_aprovacao'
  if (etapa === 'aprovado') return 'aprovado'
  return 'faturado'
}

export function linhaVazia(key: string, label: string): AndamentoLinha {
  return {
    key,
    label,
    itens: { liberado: 0, revisado: 0, aprovado: 0, faturado: 0 },
    valor: { liberado: 0, revisado: 0, aprovado: 0, faturado: 0 },
  }
}

function soma(l: AndamentoLinha, campo: 'itens' | 'valor') {
  return ETAPAS.reduce((acc, e) => acc + l[campo][e.key], 0)
}

const money = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)
const pct = (parte: number, todo: number) => (todo > 0 ? `${Math.round((parte / todo) * 100)}%` : '—')

// Atributos comuns das celulas clicaveis: sem onSelecionar o painel continua
// so leitura, como era.
function clicavel(onClick: (() => void) | undefined, ativo: boolean) {
  if (!onClick) return {}
  return {
    role: 'button' as const,
    tabIndex: 0,
    'aria-pressed': ativo,
    onClick,
    onKeyDown: (event: KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        onClick()
      }
    },
  }
}

export default function AndamentoPorRegra({
  linhas,
  faturadoMes,
  mesLabel,
  onSelecionar,
  selecao,
}: {
  linhas: AndamentoLinha[]
  faturadoMes: FaturadoMes[] | null
  mesLabel: string
  onSelecionar?: (regra: string | null, etapa: EtapaKey | null) => void
  selecao?: AndamentoSelecao
}) {
  const [medida, setMedida] = useState<'valor' | 'itens'>('valor')
  const total = linhas.reduce((acc, l) => {
    for (const e of ETAPAS) {
      acc.itens[e.key] += l.itens[e.key]
      acc.valor[e.key] += l.valor[e.key]
    }
    return acc
  }, linhaVazia('total', 'Total'))
  const todas = [...linhas.filter((l) => soma(l, 'itens') > 0), total]
  const fatMes = (key: string) => faturadoMes?.find((f) => f.key === key) ?? null
  const fatMesTotal = faturadoMes
    ? faturadoMes.reduce((acc, f) => ({ key: 'total', itens: acc.itens + f.itens, valor: acc.valor + f.valor }), { key: 'total', itens: 0, valor: 0 })
    : null

  const interativo = Boolean(onSelecionar)
  const selRegra = selecao?.regra ?? null
  const selEtapa = selecao?.etapa ?? null
  // Linha Total = "todas as regras" (regra null). A selecao casa quando regra e
  // etapa coincidem; regra selecionada sem etapa realca a linha inteira.
  // Sem nada selecionado a linha Total nao ganha destaque: "tudo" nao e filtro.
  const haSelecao = selRegra !== null || selEtapa !== null
  const regraDaLinha = (l: AndamentoLinha) => (l.key === 'total' ? null : l.key)
  const linhaAtiva = (l: AndamentoLinha) => interativo && haSelecao && selRegra === regraDaLinha(l)
  const celulaAtiva = (l: AndamentoLinha, etapa: EtapaKey | null) => linhaAtiva(l) && selEtapa === etapa
  const selecionar = (l: AndamentoLinha, etapa: EtapaKey | null) => {
    if (!onSelecionar) return undefined
    return () => onSelecionar(regraDaLinha(l), etapa)
  }
  const classeClicavel = interativo ? 'cursor-pointer hover:bg-canvas-soft' : ''
  const classeAtiva = 'ring-2 ring-inset ring-ink/60 rounded-md bg-canvas-soft'

  return (
    <div className="rounded-xl border bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-ink">Andamento por regra de cobrança</p>
          <p className="text-[11px] text-ink-mute">
            {interativo
              ? 'Clique numa regra ou etapa para filtrar a lista abaixo; o painel segue só centro de custo e usuário. As quatro primeiras colunas são o que está na fila agora; a coluna Faturado no mês vem do banco.'
              : 'Segue os filtros da tela. As quatro primeiras colunas são o que está na fila agora; a coluna Faturado no mês vem do banco.'}
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-full border p-0.5 text-xs">
          {(['valor', 'itens'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMedida(m)}
              className={`rounded-full px-3 py-1 ${medida === m ? 'bg-ink text-white' : 'text-ink-mute hover:text-ink'}`}
            >
              {m === 'valor' ? 'Barra por R$' : 'Barra por itens'}
            </button>
          ))}
        </div>
      </div>
      <div className="mb-2 flex flex-wrap gap-3 text-[11px] text-ink-mute">
        {ETAPAS.map((e) => (
          <span key={e.key} className="inline-flex items-center gap-1">
            <span className={`inline-block h-2.5 w-2.5 rounded-sm ${e.cor}`} /> {e.label}
          </span>
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-ink-mute">
              <th className="py-1.5 pr-2">Regra</th>
              <th className="py-1.5 pr-2" style={{ minWidth: 180 }}>Andamento</th>
              {ETAPAS.map((e) => (
                <th key={e.key} className="py-1.5 pr-2 text-right">{e.label}</th>
              ))}
              <th className="py-1.5 pr-2 text-right">Total na fila</th>
              <th className="py-1.5 pr-2 text-right">Pronto p/ faturar</th>
              <th className="py-1.5 text-right">Faturado no mês ({mesLabel})</th>
            </tr>
          </thead>
          <tbody>
            {todas.map((l) => {
              const totalMedida = soma(l, medida)
              const totalItens = soma(l, 'itens')
              const totalValor = soma(l, 'valor')
              const pronto = l.valor.aprovado + l.valor.faturado
              const fm = l.key === 'total' ? fatMesTotal : fatMes(l.key)
              const isTotal = l.key === 'total'
              const regraAtiva = celulaAtiva(l, null)
              return (
                <tr key={l.key} className={`border-t ${isTotal ? 'bg-canvas font-semibold' : ''}`}>
                  <td
                    className={`py-2 pr-2 whitespace-nowrap ${classeClicavel} ${regraAtiva || (linhaAtiva(l) && selEtapa !== null) ? 'font-semibold text-ink' : ''}`}
                    title={interativo ? (isTotal ? 'Mostrar todas as regras' : `Filtrar a lista por ${l.label}`) : undefined}
                    {...clicavel(selecionar(l, null), regraAtiva)}
                  >
                    {l.label}
                  </td>
                  <td className="py-2 pr-2">
                    <div className="flex h-3 w-full overflow-hidden rounded-full bg-neutral-100" title={`${totalItens} item(ns) · ${money(totalValor)}`}>
                      {ETAPAS.map((e) => {
                        const parte = l[medida][e.key]
                        const w = totalMedida > 0 ? (parte / totalMedida) * 100 : 0
                        if (w <= 0) return null
                        const ativo = celulaAtiva(l, e.key)
                        return (
                          <div
                            key={e.key}
                            className={`${e.cor} ${interativo ? 'cursor-pointer hover:opacity-80' : ''} ${ativo ? 'ring-2 ring-inset ring-white' : ''}`}
                            style={{ width: `${w}%` }}
                            title={`${e.label}: ${pct(parte, totalMedida)}`}
                            {...clicavel(selecionar(l, e.key), ativo)}
                          />
                        )
                      })}
                    </div>
                  </td>
                  {ETAPAS.map((e) => {
                    const ativo = celulaAtiva(l, e.key)
                    return (
                      <td
                        key={e.key}
                        className={`py-2 pr-2 text-right font-tabular whitespace-nowrap ${classeClicavel} ${ativo ? classeAtiva : ''}`}
                        title={interativo ? `Filtrar a lista: ${isTotal ? 'todas as regras' : l.label} · ${e.label}` : undefined}
                        {...clicavel(selecionar(l, e.key), ativo)}
                      >
                        <span className={ativo ? 'font-semibold text-ink' : 'text-ink'}>{l.itens[e.key]}</span>
                        <span className="text-ink-mute"> · {money(l.valor[e.key])}</span>
                      </td>
                    )
                  })}
                  <td
                    className={`py-2 pr-2 text-right font-tabular whitespace-nowrap ${classeClicavel} ${regraAtiva ? classeAtiva : ''}`}
                    title={interativo ? (isTotal ? 'Limpar filtros de regra e situação' : `Filtrar a lista por ${l.label}, todas as etapas`) : undefined}
                    {...clicavel(selecionar(l, null), regraAtiva)}
                  >
                    <span className={regraAtiva ? 'font-semibold text-ink' : 'text-ink'}>{totalItens}</span>
                    <span className="text-ink-mute"> · {money(totalValor)}</span>
                  </td>
                  <td className="py-2 pr-2 text-right font-tabular">{pct(pronto, totalValor)}</td>
                  <td className="py-2 text-right font-tabular whitespace-nowrap">
                    {faturadoMes === null ? (
                      <span className="text-ink-mute">—</span>
                    ) : fm ? (
                      <>
                        <span className="text-ink">{fm.itens}</span>
                        <span className="text-ink-mute"> · {money(fm.valor)}</span>
                      </>
                    ) : (
                      <span className="text-ink-mute">0 · {money(0)}</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
