import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import ContratosList from '@/components/contratos/contratos-list'
import ContratosDashboard from '@/components/contratos/contratos-dashboard'
import ContratosInbox from '@/components/contratos/contratos-inbox'

export const dynamic = 'force-dynamic'

export default async function ContratosPage() {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()

  if (!session) redirect('/login')

  return (
    <div className="container mx-auto py-10">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Contratos</h1>
        <p className="mt-2 text-gray-600">Gerencie contratos e seus casos vinculados</p>
      </div>
      <div className="mb-4">
        <ContratosInbox />
      </div>
      <div className="mb-4">
        <ContratosDashboard />
      </div>
      <ContratosList />
    </div>
  )
}
