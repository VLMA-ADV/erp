import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import FornecedoresList from '@/components/fornecedores/fornecedores-list'
import FornecedoresPageClient from '@/components/fornecedores/fornecedores-page-client'

export const dynamic = 'force-dynamic'

export default async function FornecedoresPage() {
  const supabase = await createClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session) {
    redirect('/login')
  }

  return (
    <div className="container mx-auto py-10">
      <FornecedoresPageClient />
      <FornecedoresList />
    </div>
  )
}

