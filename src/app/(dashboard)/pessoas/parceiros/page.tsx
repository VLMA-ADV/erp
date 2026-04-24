import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import ParceirosList from '@/components/parceiros/parceiros-list'
import ParceirosPageClient from '@/components/parceiros/parceiros-page-client'

export const dynamic = 'force-dynamic'

export default async function ParceirosPage() {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()

  if (!session) {
    redirect('/login')
  }

  return (
    <div className="container mx-auto py-10">
      <ParceirosPageClient />
      <ParceirosList />
    </div>
  )
}

