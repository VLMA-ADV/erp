'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/ui/toast'

/**
 * Aba "Postergados" (pedido Filipe, 17/08: "acho que precisamos ter uma aba de
 * 'faturas postergadas' pra visualizar isso").
 *
 * Junta as duas coisas que hoje moram em lugares diferentes: a hora adiada,
 * que grava periodo_faturamento no próprio timesheet, e o item de regra
 * (mensalidade, projeto, parcela), que grava uma linha em
 * finance.faturamento_adiamentos. Para quem olha a tela é o mesmo assunto —
 * "o que eu empurrei para frente e para quando".
 */
interface Postergado {
  id: string
  fonte: 'hora' | 'regra'
  item_tipo: string
  descricao: string
  valor: number
  competencia: string
  periodo_novo: string
  motivo: string | null
  caso_numero: number | null
  caso_nome: string | null
  cliente_nome: string | null
}

const TIPO_LABEL: Record<string, string> = {
  timesheet: 'Horas',
  mensal: 'Mensalidade',
  mensalidade_processo: 'Mensalidade de processo',
  projeto: 'Projeto',
  projeto_parcela: 'Parcela de projeto',
  exito: 'Êxito',
}

function fmtMoney(v: number | string | null | undefined) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v || 0))
}
function fmtMes(iso: string | null) {
  if (!iso) return '—'
  const [a, m] = iso.split('-')
  return m && a ? `${m}/${a}` : iso
}

export default function PostergadosList() {
  const [itens, setItens] = useState<Postergado[]>([])
  const [carregando, setCarregando] = useState(true)
  const [desfazendo, setDesfazendo] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const { success, error: toastError } = useToast()

  const carregar = useCallback(async () => {
    try {
      setCarregando(true)
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data, error } = await supabase.rpc('get_faturamento_postergados', { p_user_id: user.id })
      if (error) throw error
      setItens((data || []) as Postergado[])
    } catch (err) {
      console.error(err)
      setErro('Erro ao carregar os itens postergados.')
    } finally {
      setCarregando(false)
    }
    // Sem toastError na lista de dependências de propósito: o toast vem do
    // contexto e é recriado a cada render, entao entrar aqui faria carregar()
    // mudar de identidade toda vez, o useEffect disparar de novo e a tela
    // ficar em "Carregando…" para sempre — foi exatamente o que aconteceu.
  }, [])

  useEffect(() => { void carregar() }, [carregar])

  const desfazer = async (item: Postergado) => {
    if (item.fonte === 'hora') {
      toastError('Hora adiada se desfaz na própria fila do mês de destino.')
      return
    }
    if (!window.confirm(`Trazer "${item.descricao}" de volta para ${fmtMes(item.competencia)}?`)) return
    try {
      setDesfazendo(item.id)
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { error } = await supabase.rpc('desfazer_adiamento', { p_user_id: user.id, p_adiamento_id: item.id })
      if (error) throw error
      success('Adiamento desfeito')
      await carregar()
    } catch (err) {
      console.error(err)
      toastError(err instanceof Error ? err.message : 'Erro ao desfazer')
    } finally {
      setDesfazendo(null)
    }
  }

  if (carregando) return <p className="p-6 text-sm text-ink-mute">Carregando…</p>
  if (erro) return <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-6 text-sm text-destructive">{erro}</p>

  if (itens.length === 0) {
    return (
      <p className="rounded-lg border border-hairline bg-white p-6 text-sm text-ink-mute">
        Nada postergado. O que for adiado na fila de itens a faturar aparece aqui, com o mês de origem e o de destino.
      </p>
    )
  }

  const total = itens.reduce((s, i) => s + Number(i.valor || 0), 0)

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-mute">
        {itens.length} item(ns) adiado(s), somando{' '}
        <span className="font-tabular font-medium text-ink">{fmtMoney(total)}</span>. Eles saíram da fila do mês de
        origem e reaparecem na do mês de destino.
      </p>

      <div className="overflow-x-auto rounded-lg border border-hairline bg-white">
        <table className="w-full min-w-[860px] text-sm">
          <thead className="border-b border-hairline text-left text-xs uppercase tracking-wide text-ink-mute">
            <tr>
              <th className="p-3">Cliente / caso</th>
              <th className="p-3">Item</th>
              <th className="p-3 text-right">Valor</th>
              <th className="p-3">De</th>
              <th className="p-3">Para</th>
              <th className="p-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {itens.map((i) => (
              <tr key={`${i.fonte}-${i.id}`}>
                <td className="p-3">
                  <p className="font-medium text-ink">{i.cliente_nome || '—'}</p>
                  <p className="text-xs text-ink-mute">
                    {i.caso_numero ? `#${i.caso_numero} · ` : ''}{i.caso_nome || '—'}
                  </p>
                </td>
                <td className="p-3">
                  <span className="rounded bg-secondary px-1.5 py-0.5 text-xs">
                    {TIPO_LABEL[i.item_tipo] || i.item_tipo}
                  </span>
                  <p className="mt-0.5 text-xs text-ink-mute">{i.descricao}</p>
                </td>
                <td className="p-3 text-right font-tabular">{fmtMoney(i.valor)}</td>
                <td className="p-3 font-tabular text-ink-mute">{fmtMes(i.competencia)}</td>
                <td className="p-3 font-tabular font-medium text-ink">{fmtMes(i.periodo_novo)}</td>
                <td className="p-3 text-right">
                  {i.fonte === 'regra' ? (
                    <button
                      onClick={() => void desfazer(i)}
                      disabled={desfazendo === i.id}
                      className="rounded border border-hairline px-2 py-1 text-xs hover:bg-canvas-soft disabled:opacity-50"
                    >
                      {desfazendo === i.id ? '…' : 'Desfazer'}
                    </button>
                  ) : (
                    <span className="text-xs text-ink-mute">hora</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
