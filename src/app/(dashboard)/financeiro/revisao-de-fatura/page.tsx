import { redirect } from 'next/navigation'
import RevisaoDeFaturaList from '@/components/faturamento/revisao-de-fatura-list'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function RevisaoDeFaturaPage() {
  const supabase = await createClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session) redirect('/login')

  return (
    <div className="container mx-auto px-6 py-12">
      <header className="mb-8">
        <span className="text-eyebrow">FINANCEIRO</span>
        <h1 className="mt-2 display-lg text-ink">Revisão de fatura</h1>
        <p className="mt-2 text-sm text-ink-mute">Revisão de snapshot por caso e regra financeira antes da aprovação.</p>
      </header>
      <RevisaoDeFaturaList />
    </div>
  )
}
