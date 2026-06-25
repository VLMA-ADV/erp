import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import TimesheetList from '@/components/timesheet/timesheet-list'
import GestaoHorasDashboard from '@/components/timesheet/gestao-horas-dashboard'

export const dynamic = 'force-dynamic'

export default async function TimesheetPage() {
  const supabase = await createClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session) redirect('/login')

  return (
    <div className="container mx-auto px-6 py-12">
      <header className="mb-8">
        <span className="text-eyebrow">OPERAÇÃO</span>
        <h1 className="mt-2 display-lg text-ink">Timesheet</h1>
        <p className="mt-2 text-sm text-ink-mute">Lançamentos de horas por contrato e caso</p>
      </header>
      <GestaoHorasDashboard />
      <TimesheetList />
    </div>
  )
}
