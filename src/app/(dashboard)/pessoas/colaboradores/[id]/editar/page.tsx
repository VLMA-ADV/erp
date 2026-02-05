import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import ColaboradorEditForm from '@/components/colaboradores/colaborador-edit-form'

export default async function EditarColaboradorPage({
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
    <div className="container mx-auto py-10">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Editar Colaborador</h1>
        <p className="mt-2 text-gray-600">Edite os dados do colaborador</p>
      </div>
      <ColaboradorEditForm colaboradorId={params.id} />
    </div>
  )
}
