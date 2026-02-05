import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import ColaboradoresList from '@/components/colaboradores/colaboradores-list'
import ColaboradoresPageClient from '@/components/colaboradores/colaboradores-page-client'

export const dynamic = 'force-dynamic'

export default async function ColaboradoresPage() {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()

  if (!session) {
    redirect('/login')
  }

  return (
    <div className="container mx-auto py-10">
      <ColaboradoresPageClient />
      <ColaboradoresList />
    </div>
  )
}
