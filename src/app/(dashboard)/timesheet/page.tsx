import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import TimesheetHome from '@/components/timesheet/timesheet-home'

export const dynamic = 'force-dynamic'

export default async function TimesheetPage() {
  const supabase = await createClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session) redirect('/login')

  return (
    <div className="container mx-auto px-6 py-12">
      <TimesheetHome />
    </div>
  )
}
