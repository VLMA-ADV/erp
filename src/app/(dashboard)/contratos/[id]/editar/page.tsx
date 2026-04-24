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
    <div className="container mx-auto py-10">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">{viewOnly ? 'Visualizar Contrato' : 'Editar Contrato'}</h1>
        <p className="mt-2 text-gray-600">{viewOnly ? 'Visualize os dados do contrato' : 'Atualize os dados do contrato'}</p>
      </div>
      <ContratoForm contratoId={id} viewOnly={viewOnly} />
    </div>
  )
}
