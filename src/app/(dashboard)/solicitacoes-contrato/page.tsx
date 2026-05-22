import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import SolicitacoesContratoList from '@/components/solicitacoes-contrato/solicitacoes-contrato-list'

export const dynamic = 'force-dynamic'

export default async function SolicitacoesContratoPage() {
  const supabase = await createClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session) redirect('/login')

  return (
    <div className="container mx-auto px-6 py-12">
      <header className="mb-8">
        <span className="text-eyebrow">OPERAÇÃO</span>
        <h1 className="mt-2 display-lg text-ink">Solicitações de Contrato</h1>
        <p className="mt-2 text-sm text-ink-mute">Gerencie solicitações de abertura de contrato</p>
      </header>
      <SolicitacoesContratoList />
    </div>
  )
}
