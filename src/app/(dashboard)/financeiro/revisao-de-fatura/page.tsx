import { redirect } from 'next/navigation'
import RevisaoDeFaturaList from '@/components/faturamento/revisao-de-fatura-list'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function RevisaoDeFaturaPage() {
  const supabase = await createClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session) redirect('/login')

  return (
    <div className="container mx-auto py-10">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Revisão de fatura</h1>
        <p className="mt-2 text-gray-600">Revisão de snapshot por caso e regra financeira antes da aprovação.</p>
      </div>
      <RevisaoDeFaturaList />
    </div>
  )
}
