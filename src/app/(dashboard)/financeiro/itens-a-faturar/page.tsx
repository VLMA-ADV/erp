import { redirect } from 'next/navigation'
import ItensAFaturarList from '@/components/faturamento/itens-a-faturar-list'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function ItensAFaturarPage() {
  const supabase = await createClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session) redirect('/login')

  return (
    <div className="container mx-auto px-6 py-12">
      <header className="mb-8">
        <span className="text-eyebrow">FINANCEIRO</span>
        <h1 className="mt-2 display-lg text-ink">Itens a faturar</h1>
        <p className="mt-2 text-sm text-ink-mute">Consolidação por cliente, contrato e caso para início do fluxo de faturamento.</p>
      </header>
      <ItensAFaturarList />
    </div>
  )
}
