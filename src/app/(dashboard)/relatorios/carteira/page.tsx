import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import RelatorioCarteira from '@/components/relatorios/relatorio-carteira'

export const dynamic = 'force-dynamic'

export default async function RelatorioCarteiraPage() {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) redirect('/login')

  return (
    <div className="container mx-auto px-6 py-12">
      <header className="mb-8">
        <span className="text-eyebrow">RELATÓRIOS</span>
        <h1 className="mt-2 display-lg text-ink">Carteira e regras de cobrança</h1>
        <p className="mt-2 text-sm text-ink-mute">
          Cliente, contrato, caso e regra de cobrança, com os casos que faturaram no mês e os que
          precisam de atenção.
        </p>
      </header>
      <RelatorioCarteira userId={session.user.id} />
    </div>
  )
}
