import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import CargosList from '@/components/configuracao/cargos-list'

export const dynamic = 'force-dynamic'

export default async function CargosPage() {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()

  if (!session) {
    redirect('/login')
  }

  return (
    <div className="container mx-auto py-10">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Cargos</h1>
        <p className="mt-2 text-gray-600">Gerencie os cargos da empresa</p>
      </div>
      <CargosList />
    </div>
  )
}
