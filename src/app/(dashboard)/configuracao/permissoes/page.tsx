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
    <div className="container mx-auto px-6 py-12">
      <header className="mb-8">
        <span className="text-eyebrow">CONFIGURAÇÃO</span>
        <h1 className="mt-2 display-lg text-ink">Permissões</h1>
        <p className="mt-2 text-sm text-ink-mute">Visualize as permissões do sistema</p>
      </header>
      <PermissionsList />
    </div>
  )
}
