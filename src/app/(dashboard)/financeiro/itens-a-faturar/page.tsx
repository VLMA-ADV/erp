import { redirect } from 'next/navigation'
import ItensAFaturarList from '@/components/faturamento/itens-a-faturar-list'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function ItensAFaturarPage() {
  const supabase = await createClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session) redirect('/login')

  return (
    <div className="container mx-auto py-10">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Itens a faturar</h1>
        <p className="mt-2 text-gray-600">Consolidação por cliente, contrato e caso para início do fluxo de faturamento.</p>
      </div>
      <ItensAFaturarList />
    </div>
  )
}
