import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import AreasList from '@/components/configuracao/areas-list'

export default async function AreasPage() {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()

  if (!session) {
    redirect('/login')
  }

  return (
    <div className="container mx-auto py-10">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Áreas</h1>
        <p className="mt-2 text-gray-600">Gerencie as áreas de atuação da empresa</p>
      </div>
      <AreasList />
    </div>
  )
}
