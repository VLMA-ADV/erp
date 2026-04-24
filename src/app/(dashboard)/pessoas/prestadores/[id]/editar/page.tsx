import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import PrestadorForm from '@/components/prestadores/prestador-form'

export const dynamic = 'force-dynamic'

export default async function EditarPrestadorPage({
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
        <h1 className="text-3xl font-bold">Editar Prestador de Serviço</h1>
        <p className="mt-2 text-gray-600">Edite os dados do prestador</p>
      </div>
      <PrestadorForm prestadorId={params.id} />
    </div>
  )
}

