import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import ClienteForm from '@/components/clientes/cliente-form'

export const dynamic = 'force-dynamic'

export default async function NovoClientePage() {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()

  if (!session) {
    redirect('/login')
  }

  return (
    <div className="container mx-auto px-6 py-12">
      <header className="mb-8">
        <span className="text-eyebrow">PESSOAS</span>
        <h1 className="mt-2 display-lg text-ink">Novo Cliente</h1>
        <p className="mt-2 text-sm text-ink-mute">Cadastre um novo cliente</p>
      </header>
      <ClienteForm />
    </div>
  )
}

