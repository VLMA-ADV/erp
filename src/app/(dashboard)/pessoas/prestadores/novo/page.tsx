import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import PrestadorForm from '@/components/prestadores/prestador-form'

export const dynamic = 'force-dynamic'

export default async function NovoPrestadorPage() {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()

  if (!session) {
    redirect('/login')
  }

  return (
    <div className="container mx-auto px-6 py-12">
      <header className="mb-8">
        <span className="text-eyebrow">PESSOAS</span>
        <h1 className="mt-2 display-lg text-ink">Novo Prestador de Serviço</h1>
        <p className="mt-2 text-sm text-ink-mute">Cadastre um novo prestador</p>
      </header>
      <PrestadorForm />
    </div>
  )
}

