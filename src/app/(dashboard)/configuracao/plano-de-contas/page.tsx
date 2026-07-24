import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import PlanoDeContasList from '@/components/configuracao/plano-de-contas-list'

export const dynamic = 'force-dynamic'

export default async function PlanoDeContasPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  return (
    <div className="container mx-auto px-6 py-12">
      <header className="mb-8">
        <span className="text-eyebrow">CONFIGURAÇÃO</span>
        <h1 className="mt-2 display-lg text-ink">Plano de Contas</h1>
        <p className="mt-2 text-sm text-ink-mute">
          Edite a estrutura Grupo → Conta Sintética → Conta Analítica usada nos lançamentos.
        </p>
      </header>
      <PlanoDeContasList />
    </div>
  )
}
