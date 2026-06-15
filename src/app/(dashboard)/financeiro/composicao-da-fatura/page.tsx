import { redirect } from 'next/navigation'
import ComposicaoDaFaturaList from '@/components/faturamento/composicao-da-fatura-list'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function ComposicaoDaFaturaPage() {
  const supabase = await createClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session) redirect('/login')

  return (
    <div className="container mx-auto px-6 py-12">
      <header className="mb-8">
        <span className="text-eyebrow">FINANCEIRO</span>
        <h1 className="mt-2 display-lg text-ink">Composição da fatura</h1>
        <p className="mt-2 text-sm text-ink-mute">
          Reúne, por cliente e contrato, o kit da fatura: nota fiscal de serviço, boleto, relatório de timesheet e nota
          de despesa dos itens aprovados pelo financeiro.
        </p>
      </header>
      <ComposicaoDaFaturaList />
    </div>
  )
}
