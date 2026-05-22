import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import ParceiroForm from '@/components/parceiros/parceiro-form'

export const dynamic = 'force-dynamic'

export default async function EditarParceiroPage({
  params,
}: {
  params: { id: string }
}) {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()

  if (!session) {
    redirect('/login')
  }

  return (
    <div className="container mx-auto px-6 py-12">
      <header className="mb-8">
        <span className="text-eyebrow">PESSOAS</span>
        <h1 className="mt-2 display-lg text-ink">Editar Parceiro</h1>
        <p className="mt-2 text-sm text-ink-mute">Edite os dados do parceiro</p>
      </header>
      <ParceiroForm parceiroId={params.id} />
    </div>
  )
}

