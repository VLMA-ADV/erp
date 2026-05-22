import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()

  if (!session) {
    redirect('/login')
  }

  return (
    <div className="container mx-auto px-6 py-16">
      <span className="text-eyebrow">VLMA · ERP</span>
      <h1 className="mt-3 display-xl text-ink">Dashboard</h1>
      <p className="mt-4 max-w-prose text-base text-ink-mute">
        Bem-vindo ao sistema da Voa Legal Marcas e Advocacia.
      </p>
    </div>
  )
}
