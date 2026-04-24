import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import FornecedorForm from '@/components/fornecedores/fornecedor-form'

export const dynamic = 'force-dynamic'

export default async function EditarFornecedorPage({
  params,
}: {
  params: { id: string }
}) {
  const supabase = await createClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session) {
    redirect('/login')
  }

  return (
    <div className="container mx-auto py-10">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Editar Fornecedor</h1>
        <p className="mt-2 text-gray-600">Edite os dados do fornecedor</p>
      </div>
      <FornecedorForm fornecedorId={params.id} />
    </div>
  )
}

