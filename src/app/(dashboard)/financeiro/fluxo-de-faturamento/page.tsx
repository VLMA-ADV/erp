import { redirect } from 'next/navigation'
import FluxoDeFaturamentoList from '@/components/faturamento/fluxo-de-faturamento-list'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function FluxoDeFaturamentoPage() {
  const supabase = await createClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session) redirect('/login')

  return (
    <div className="container mx-auto py-10">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Fluxo de faturamento</h1>
        <p className="mt-2 text-gray-600">Acompanhe os contratos em revisão, aprovação, faturado e cancelado.</p>
      </div>
      <FluxoDeFaturamentoList />
    </div>
  )
}
