import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import CrmPipeline from '@/components/crm/crm-pipeline'
import CrmDashboard from '@/components/crm/crm-dashboard'
import { SectionTabs } from '@/components/ui/section-tabs'

export const dynamic = 'force-dynamic'

export default async function CrmPage() {
  const supabase = await createClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session) redirect('/login')

  return (
    <div className="container mx-auto px-6 py-12">
      <header className="mb-8">
        <span className="text-eyebrow">COMERCIAL</span>
        <h1 className="mt-2 display-lg text-ink">CRM</h1>
        <p className="mt-2 text-sm text-ink-mute">Acompanhe oportunidades em Kanban da prospecção até conversão.</p>
      </header>
      <SectionTabs
        tabs={[
          { value: 'pipeline', label: 'Pipeline', content: <CrmPipeline /> },
          { value: 'indicadores', label: 'Indicadores', content: <CrmDashboard /> },
        ]}
      />
    </div>
  )
}
