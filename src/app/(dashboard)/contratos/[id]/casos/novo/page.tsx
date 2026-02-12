import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import CasoForm from '@/components/contratos/caso-form'

export const dynamic = 'force-dynamic'

export default async function NovoCasoPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()

  if (!session) redirect('/login')

  return (
    <div className="container mx-auto py-10">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Novo Caso</h1>
        <p className="mt-2 text-gray-600">Cadastre um novo caso para o contrato</p>
      </div>
      <CasoForm contratoId={id} />
    </div>
  )
}
