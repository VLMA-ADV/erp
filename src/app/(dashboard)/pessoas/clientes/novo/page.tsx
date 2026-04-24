import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import ClienteForm from '@/components/clientes/cliente-form'

export const dynamic = 'force-dynamic'

export default async function NovoClientePage() {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()

  if (!session) {
    redirect('/login')
  }

  return (
    <div className="container mx-auto py-10">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Novo Cliente</h1>
        <p className="mt-2 text-gray-600">Cadastre um novo cliente</p>
      </div>
      <ClienteForm />
    </div>
  )
}

