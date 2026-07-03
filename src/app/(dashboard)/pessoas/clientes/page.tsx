import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import ClientesList from '@/components/clientes/clientes-list'
import ClientesPageClient from '@/components/clientes/clientes-page-client'
import ClientesDashboard from '@/components/clientes/clientes-dashboard'

export const dynamic = 'force-dynamic'

export default async function ClientesPage() {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()

  if (!session) {
    redirect('/login')
  }

  return (
    <div className="container mx-auto px-6 py-12">
      <ClientesPageClient />
      <div className="mb-6">
        <p className="text-eyebrow mb-3">Indicadores</p>
        <ClientesDashboard />
      </div>
      <ClientesList />
    </div>
  )
}

