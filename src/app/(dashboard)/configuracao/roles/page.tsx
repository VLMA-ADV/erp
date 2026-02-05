import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import RolesList from '@/components/configuracao/roles-list'

export default async function RolesPage() {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()

  if (!session) {
    redirect('/login')
  }

  return (
    <div className="container mx-auto py-10">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Roles</h1>
        <p className="mt-2 text-gray-600">Gerencie as roles do sistema</p>
      </div>
      <RolesList />
    </div>
  )
}
