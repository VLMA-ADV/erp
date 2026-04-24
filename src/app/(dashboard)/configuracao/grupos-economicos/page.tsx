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
    <div className="container mx-auto py-10">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Grupos Econômicos</h1>
        <p className="mt-2 text-gray-600">Gerencie os grupos econômicos para agrupamento de clientes</p>
      </div>
      <GruposEconomicosList />
    </div>
  )
}
