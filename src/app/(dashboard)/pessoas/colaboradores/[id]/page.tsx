import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import ColaboradorView from '@/components/colaboradores/colaborador-view'

export const dynamic = 'force-dynamic'

export default async function ColaboradorPage({
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
        <h1 className="mt-2 display-lg text-ink">Visualizar Colaborador</h1>
      </header>
      <ColaboradorView colaboradorId={params.id} />
    </div>
  )
}
