import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import ColaboradorFormComplete from '@/components/colaboradores/colaborador-form-complete'

export const dynamic = 'force-dynamic'

export default async function NovoColaboradorPage() {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()

  if (!session) {
    redirect('/login')
  }

  return (
    <div className="container mx-auto py-10">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Novo Colaborador</h1>
        <p className="mt-2 text-gray-600">Cadastre um novo colaborador no sistema</p>
      </div>
      <ColaboradorFormComplete />
    </div>
  )
}
