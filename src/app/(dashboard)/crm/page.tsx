import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import CrmPipeline from '@/components/crm/crm-pipeline'

export const dynamic = 'force-dynamic'

export default async function CrmPage() {
  const supabase = await createClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session) redirect('/login')

  return (
    <div className="container mx-auto py-10">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">CRM</h1>
        <p className="mt-2 text-gray-600">Acompanhe oportunidades em Kanban da prospecção até conversão.</p>
      </div>
      <CrmPipeline />
    </div>
  )
}
