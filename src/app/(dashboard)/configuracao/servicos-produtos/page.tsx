import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import ServicosProdutosList from '@/components/configuracao/servicos-produtos-list'

export const dynamic = 'force-dynamic'

export default async function ServicosProdutosPage() {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()

  if (!session) redirect('/login')

  return (
    <div className="container mx-auto py-10">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Produtos</h1>
        <p className="mt-2 text-gray-600">Gerencie os produtos da empresa</p>
      </div>
      <ServicosProdutosList />
    </div>
  )
}
