import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import PrestadoresList from '@/components/prestadores/prestadores-list'
import PrestadoresPageClient from '@/components/prestadores/prestadores-page-client'

export const dynamic = 'force-dynamic'

export default async function PrestadoresPage() {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()

  if (!session) {
    redirect('/login')
  }

  return (
    <div className="container mx-auto py-10">
      <PrestadoresPageClient />
      <PrestadoresList />
    </div>
  )
}

