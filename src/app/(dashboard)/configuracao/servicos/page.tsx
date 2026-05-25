import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import ServicosList from '@/components/configuracao/servicos-list'

export const dynamic = 'force-dynamic'

export default async function ServicosPage() {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()

  if (!session) redirect('/login')

  return (
    <div className="container mx-auto px-6 py-12">
      <header className="mb-8">
        <span className="text-eyebrow">CONFIGURAÇÃO</span>
        <h1 className="mt-2 display-lg text-ink">Serviços</h1>
        <p className="mt-2 text-sm text-ink-mute">Gerencie os serviços da empresa</p>
      </header>
      <ServicosList />
    </div>
  )
}
