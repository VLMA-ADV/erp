import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import DespesasList from '@/components/despesas/despesas-list'

export const dynamic = 'force-dynamic'

export default async function DespesasPage() {
  const supabase = await createClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session) redirect('/login')

  return (
    <div className="container mx-auto py-10">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Despesas</h1>
        <p className="mt-2 text-gray-600">Lançamentos por cliente e caso, com categoria, descrição e arquivo.</p>
      </div>
      <DespesasList />
    </div>
  )
}
