import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import GruposEconomicosList from '@/components/configuracao/grupos-economicos-list'

export const dynamic = 'force-dynamic'

export default async function GruposEconomicosPage() {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()

  if (!session) {
    redirect('/login')
  }

  return (
    <div className="container mx-auto px-6 py-12">
      <header className="mb-8">
        <span className="text-eyebrow">CONFIGURAÇÃO</span>
        <h1 className="mt-2 display-lg text-ink">Grupos Econômicos</h1>
        <p className="mt-2 text-sm text-ink-mute">Gerencie os grupos econômicos para agrupamento de clientes</p>
      </header>
      <GruposEconomicosList />
    </div>
  )
}
