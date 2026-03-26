import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import ResetSenhaAdmin from '@/components/configuracao/reset-senha-admin'

export const dynamic = 'force-dynamic'

export default async function UsuariosAdminPage() {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()

  if (!session) {
    redirect('/login')
  }

  return (
    <div className="container mx-auto py-10">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Gestão de Usuários</h1>
        <p className="mt-2 text-gray-600">Ferramentas administrativas de acesso</p>
      </div>
      <ResetSenhaAdmin />
    </div>
  )
}
