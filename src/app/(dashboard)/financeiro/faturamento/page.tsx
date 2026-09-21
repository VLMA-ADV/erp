import { redirect } from 'next/navigation'
import FaturamentoUnificado from '@/components/faturamento/faturamento-unificado'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/**
 * Tela única de faturamento.
 *
 * Antes juntava, por composição, "1. Itens a faturar" (fila de liberação) e
 * "2. Revisão de fatura" numa página só. Desde setembro/2026 a fila deixou de
 * ser uma seção própria: virou a etapa "Na fila" DENTRO da Revisão, calculada
 * ao vivo, e a Revisão ganhou abas por mês de faturamento (competência).
 *
 * O componente antigo (itens-a-faturar-list.tsx) continua existindo e a rota
 * /financeiro/itens-a-faturar segue viva — fora do menu, salvo com
 * NEXT_PUBLIC_ETAPA1_LEGADA=true — como válvula de escape.
 */
export default async function FaturamentoUnificadoPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  return (
    <div className="container mx-auto px-6 py-12">
      <FaturamentoUnificado />
    </div>
  )
}
