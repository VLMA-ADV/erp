import { redirect } from 'next/navigation'
import Link from 'next/link'
import ContasAPagarDashboard from '@/components/contas-a-pagar/contas-a-pagar-dashboard'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function ContasAPagarPage() {
  const supabase = await createClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session) redirect('/login')

  return (
    <div className="container mx-auto px-6 py-12">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <span className="text-eyebrow">FINANCEIRO</span>
          <h1 className="mt-2 display-lg text-ink">Contas a pagar e receber</h1>
          <p className="mt-2 text-sm text-ink-mute">Rotina diária: despesas, recebimentos e saldo do dia.</p>
        </div>
        <Link
          href="/financeiro/contas-a-pagar/novo"
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          + Nova conta
        </Link>
      </header>
      <ContasAPagarDashboard />
    </div>
  )
}
