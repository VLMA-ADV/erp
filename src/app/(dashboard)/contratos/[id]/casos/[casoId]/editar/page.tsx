import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import CasoForm from '@/components/contratos/caso-form'

export const dynamic = 'force-dynamic'

export default async function EditarCasoPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; casoId: string }>
  searchParams: Promise<{ view?: string }>
}) {
  const [{ id, casoId }, query] = await Promise.all([params, searchParams])

  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()

  if (!session) redirect('/login')

  const viewOnly = query.view === '1'

  return (
    <div className="container mx-auto px-6 py-12">
      <header className="mb-8">
        <span className="text-eyebrow">OPERAÇÃO</span>
        <h1 className="mt-2 display-lg text-ink">{viewOnly ? 'Visualizar Caso' : 'Editar Caso'}</h1>
        <p className="mt-2 text-sm text-ink-mute">{viewOnly ? 'Visualize os dados do caso' : 'Atualize os dados do caso'}</p>
      </header>
      <CasoForm contratoId={id} casoId={casoId} viewOnly={viewOnly} />
    </div>
  )
}
