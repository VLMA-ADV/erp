import { redirect } from 'next/navigation'
import NotasGeradasList from '@/components/faturamento/notas-geradas-list'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function NotasGeradasPage() {
  const supabase = await createClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session) redirect('/login')

  return (
    <div className="container mx-auto py-10">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Notas geradas</h1>
        <p className="mt-2 text-gray-600">Rastreie artefatos gerados no faturamento (boleto, relatório de honorários e NF).</p>
      </div>
      <NotasGeradasList />
    </div>
  )
}
