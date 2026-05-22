import { redirect } from 'next/navigation'
import FluxoDeFaturamentoList from '@/components/faturamento/fluxo-de-faturamento-list'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function FluxoDeFaturamentoPage() {
  const supabase = await createClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session) redirect('/login')

  return (
    <div className="container mx-auto px-6 py-12">
      <header className="mb-8">
        <span className="text-eyebrow">FINANCEIRO</span>
        <h1 className="mt-2 display-lg text-ink">Fluxo de faturamento</h1>
        <p className="mt-2 text-sm text-ink-mute">Acompanhe os contratos em revisão, aprovação, faturado e cancelado.</p>
      </header>
      <FluxoDeFaturamentoList />
    </div>
  )
}
