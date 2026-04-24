import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import CategoriasPrestadoresParceirosList from '@/components/configuracao/categorias-prestadores-parceiros-list'

export const dynamic = 'force-dynamic'

export default async function CategoriasPrestadoresParceirosPage() {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()

  if (!session) redirect('/login')

  return (
    <div className="container mx-auto py-10">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Categorias Prestadores/Parceiros</h1>
        <p className="mt-2 text-gray-600">Gerencie as categorias para prestadores e parceiros</p>
      </div>
      <CategoriasPrestadoresParceirosList />
    </div>
  )
}
