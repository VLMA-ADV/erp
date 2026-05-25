import { redirect } from 'next/navigation'
import NotasGeradasList from '@/components/faturamento/notas-geradas-list'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function NotasGeradasPage() {
  const supabase = await createClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session) redirect('/login')

  return (
    <div className="container mx-auto px-6 py-12">
      <header className="mb-8">
        <span className="text-eyebrow">FINANCEIRO</span>
        <h1 className="mt-2 display-lg text-ink">Notas geradas</h1>
        <p className="mt-2 text-sm text-ink-mute">Rastreie artefatos gerados no faturamento (boleto, relatório de honorários e NF).</p>
      </header>
      <NotasGeradasList />
    </div>
  )
}
