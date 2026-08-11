'use client'

import { useEffect, useState } from 'react'
import { Wallet } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'

/**
 * Lotes de adiantamento da propria pessoa (pedido Filipe 11/08).
 *
 * O financeiro adianta um valor, a pessoa vai lancando despesas contra ele e
 * aperta "fechar lote" quando termina. O saldo pode ficar NEGATIVO de proposito:
 * quem pegou 200 e gastou 210 poe 10 do bolso e tem 10 a receber. Por isso o
 * painel mostra o vermelho como informacao, nao como erro.
 */
export interface LoteDespesa {
  id: string
  descricao: string
  valor: number
  saldo: number
  total_gasto: number
  qtd_despesas: number
  status: 'aberto' | 'em_validacao' | 'fechado' | 'cancelado'
  colaborador_nome: string | null
}

function formatMoney(valor: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(valor || 0))
}

export async function carregarLotes(filtros: Record<string, string> = {}): Promise<LoteDespesa[]> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []
  const { data, error } = await supabase.rpc('get_lotes_despesa', {
    p_user_id: user.id,
    p_filtros: filtros,
  })
  if (error) throw error
  return (data || []) as LoteDespesa[]
}

export default function LotesDoUsuario({ onMudou }: { onMudou?: () => void }) {
  const { success, error: toastError } = useToast()
  const [lotes, setLotes] = useState<LoteDespesa[]>([])
  const [carregando, setCarregando] = useState(true)
  const [enviando, setEnviando] = useState<string | null>(null)

  const recarregar = async () => {
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const todos = await carregarLotes()
      // Aqui e a visao da pessoa: so os lotes dela, e so os que ainda importam.
      setLotes(
        todos.filter(
          (lote) => lote.status === 'aberto' || lote.status === 'em_validacao',
        ),
      )
    } catch (err) {
      console.error(err)
    } finally {
      setCarregando(false)
    }
  }

  useEffect(() => {
    void recarregar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const fechar = async (lote: LoteDespesa) => {
    const aviso =
      lote.saldo > 0
        ? `Sobrou ${formatMoney(lote.saldo)}. Ao fechar, esse valor vai para o financeiro como devolução sua.`
        : lote.saldo < 0
          ? `Faltou ${formatMoney(Math.abs(lote.saldo))}. Ao fechar, esse valor vai para o financeiro como reembolso para você.`
          : 'O lote fechou certinho, sem sobra nem falta.'
    if (!window.confirm(`${aviso}\n\nFechar o lote e enviar para validação?`)) return

    try {
      setEnviando(lote.id)
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { error } = await supabase.rpc('fechar_lote_despesa', {
        p_user_id: user.id,
        p_lote_id: lote.id,
      })
      if (error) throw error
      success('Lote enviado para validação')
      await recarregar()
      onMudou?.()
    } catch (err) {
      console.error(err)
      toastError(err instanceof Error ? err.message : 'Erro ao fechar o lote')
    } finally {
      setEnviando(null)
    }
  }

  if (carregando || lotes.length === 0) return null

  return (
    <section className="rounded-lg border border-hairline bg-canvas-soft/40 p-4">
      <p className="text-eyebrow mb-3 flex items-center gap-1.5">
        <Wallet className="h-3.5 w-3.5" />
        Seus lotes de adiantamento
      </p>
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {lotes.map((lote) => (
          <li key={lote.id} className="rounded-lg border border-hairline bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-medium text-ink">{lote.descricao}</p>
                <p className="mt-0.5 text-xs text-ink-mute">
                  Adiantado {formatMoney(lote.valor)} · gasto {formatMoney(lote.total_gasto)} em{' '}
                  {lote.qtd_despesas} lançamento{lote.qtd_despesas === 1 ? '' : 's'}
                </p>
              </div>
              {lote.status === 'em_validacao' ? (
                <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                  Em validação
                </span>
              ) : null}
            </div>

            <div className="mt-3 flex items-end justify-between gap-3">
              <div>
                <p className="text-eyebrow">{lote.saldo < 0 ? 'Você tem a receber' : 'Saldo'}</p>
                <p
                  className={`font-tabular text-xl font-light ${
                    lote.saldo < 0 ? 'text-red-600' : 'text-ink'
                  }`}
                >
                  {formatMoney(Math.abs(lote.saldo))}
                </p>
              </div>
              {lote.status === 'aberto' ? (
                <Button
                  variant="outline"
                  onClick={() => void fechar(lote)}
                  disabled={enviando === lote.id}
                >
                  {enviando === lote.id ? 'Enviando...' : 'Fechar lote'}
                </Button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
