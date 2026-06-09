import { redirect } from 'next/navigation'
import Link from 'next/link'
import NovoLancamentoForm from '@/components/contas-a-pagar/novo-lancamento-form'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function NovoLancamentoPage() {
  const supabase = await createClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session) redirect('/login')

  return (
    <div className="container mx-auto px-6 py-12">
      <Link href="/financeiro/contas-a-pagar" className="text-sm text-ink-mute hover:underline">← Voltar</Link>
      <header className="mb-8 mt-4">
        <span className="text-eyebrow">FINANCEIRO</span>
        <h1 className="mt-2 display-lg text-ink">Novo lançamento</h1>
        <p className="mt-2 text-sm text-ink-mute">Cadastre uma conta a pagar ou a receber.</p>
      </header>
      <NovoLancamentoForm />
    </div>
  )
}
