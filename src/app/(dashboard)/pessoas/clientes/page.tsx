import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import ClientesList from '@/components/clientes/clientes-list'
import ClientesPageClient from '@/components/clientes/clientes-page-client'

export const dynamic = 'force-dynamic'

export default async function ClientesPage() {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()

  if (!session) {
    redirect('/login')
  }

  return (
    <div className="container mx-auto py-10">
      <ClientesPageClient />
      <ClientesList />
    </div>
  )
}

