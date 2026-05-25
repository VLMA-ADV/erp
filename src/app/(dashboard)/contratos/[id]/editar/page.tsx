import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import ContratoForm from '@/components/contratos/contrato-form'

export const dynamic = 'force-dynamic'

export default async function EditarContratoPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ view?: string }>
}) {
  const [{ id }, query] = await Promise.all([params, searchParams])

  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()

  if (!session) redirect('/login')

  const viewOnly = query.view === '1'

  return (
    <div className="container mx-auto px-6 py-12">
      <header className="mb-8">
        <span className="text-eyebrow">OPERAÇÃO</span>
        <h1 className="mt-2 display-lg text-ink">{viewOnly ? 'Visualizar Contrato' : 'Editar Contrato'}</h1>
        <p className="mt-2 text-sm text-ink-mute">{viewOnly ? 'Visualize os dados do contrato' : 'Atualize os dados do contrato'}</p>
      </header>
      <ContratoForm contratoId={id} viewOnly={viewOnly} />
    </div>
  )
}
