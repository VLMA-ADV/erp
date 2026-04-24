import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import PermissionsList from '@/components/configuracao/permissions-list'

export const dynamic = 'force-dynamic'

export default async function PermissoesPage() {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()

  if (!session) {
    redirect('/login')
  }

  return (
    <div className="container mx-auto py-10">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Permissões</h1>
        <p className="mt-2 text-gray-600">Visualize as permissões do sistema</p>
      </div>
      <PermissionsList />
    </div>
  )
}
