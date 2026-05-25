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
    <div className="gradient-mesh min-h-screen">
      <div className="container mx-auto px-6 py-16">
        <span className="text-eyebrow">VLMA · ERP</span>
        <h1 className="mt-3 display-xl text-ink">Dashboard</h1>
        <p className="mt-4 max-w-prose text-base text-ink-mute">
          Bem-vindo ao sistema da Voa Legal Marcas e Advocacia.
        </p>

        <section className="cream-band mt-12 max-w-3xl shadow-lift-1">
          <span className="text-eyebrow">Primeiros passos</span>
          <h2 className="mt-2 display-md text-ink">Por onde começar</h2>
          <p className="mt-2 text-sm text-ink-secondary">
            Acesse os módulos pelo menu lateral. Os atalhos mais usados são{' '}
            <strong className="font-medium">Contratos</strong>,{' '}
            <strong className="font-medium">Clientes</strong> e{' '}
            <strong className="font-medium">Timesheet</strong>.
          </p>
        </section>
      </div>
    </div>
  )
}
