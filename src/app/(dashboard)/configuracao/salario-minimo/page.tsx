import { redirect } from 'next/navigation'
import SalarioMinimoForm from '@/components/configuracao/salario-minimo-form'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function SalarioMinimoPage() {
  const supabase = await createClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session) redirect('/login')

  return (
    <div className="container mx-auto px-6 py-12">
      <header className="mb-8">
        <span className="text-eyebrow">CONFIGURAÇÃO</span>
        <h1 className="mt-2 display-lg text-ink">Salário Mínimo</h1>
        <p className="mt-2 text-sm text-ink-mute">Configure o valor manual usado nas regras de cobrança por SM.</p>
      </header>
      <SalarioMinimoForm />
    </div>
  )
}
