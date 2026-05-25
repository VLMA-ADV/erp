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
    <div className="container mx-auto px-6 py-12">
      <header className="mb-8">
        <span className="text-eyebrow">CONFIGURAÇÃO</span>
        <h1 className="mt-2 display-lg text-ink">Gestão de Usuários</h1>
        <p className="mt-2 text-sm text-ink-mute">Ferramentas administrativas de acesso</p>
      </header>
      <ResetSenhaAdmin />
    </div>
  )
}
