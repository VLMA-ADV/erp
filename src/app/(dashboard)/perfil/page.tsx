import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import AlterarSenhaForm from '@/components/perfil/alterar-senha-form'

export const dynamic = 'force-dynamic'

export default async function PerfilPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  return (
    <div className="container mx-auto px-6 py-8">
      <span className="text-eyebrow">Conta</span>
      <h1 className="mt-2 display-md text-ink">Meu perfil</h1>
      <p className="mt-1 text-sm text-ink-mute">{user.email}</p>

      <section className="mt-8">
        <h2 className="mb-3 text-base font-semibold text-ink">Alterar senha</h2>
        <AlterarSenhaForm />
      </section>
    </div>
  )
}
