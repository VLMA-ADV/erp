import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import DespesasList from '@/components/despesas/despesas-list'

export const dynamic = 'force-dynamic'

export default async function DespesasPage() {
  const supabase = await createClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session) redirect('/login')

  return (
    <div className="container mx-auto px-6 py-12">
      <header className="mb-8">
        <span className="text-eyebrow">OPERAÇÃO</span>
        <h1 className="mt-2 display-lg text-ink">Despesas</h1>
        <p className="mt-2 text-sm text-ink-mute">Lançamentos por cliente e caso, com categoria, descrição e arquivo.</p>
      </header>
      <DespesasList />
    </div>
  )
}
