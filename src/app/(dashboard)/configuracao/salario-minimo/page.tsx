import { redirect } from 'next/navigation'
import SalarioMinimoForm from '@/components/configuracao/salario-minimo-form'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function SalarioMinimoPage() {
  const supabase = await createClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session) redirect('/login')

  return (
    <div className="container mx-auto py-10">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Salário Mínimo</h1>
        <p className="mt-2 text-gray-600">Configure o valor manual usado nas regras de cobrança por SM.</p>
      </div>
      <SalarioMinimoForm />
    </div>
  )
}
