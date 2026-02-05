import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import ColaboradorView from '@/components/colaboradores/colaborador-view'

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
    <div className="container mx-auto py-10">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Visualizar Colaborador</h1>
      </div>
      <ColaboradorView colaboradorId={params.id} />
    </div>
  )
}
