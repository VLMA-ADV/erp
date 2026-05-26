import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import ReportBuilder from '@/components/relatorios/report-builder'

export const dynamic = 'force-dynamic'

export default async function RelatorioPersonalizadoPage() {
  const supabase = await createClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session) redirect('/login')

  return (
    <div className="container mx-auto px-6 py-12">
      <header className="mb-8">
        <span className="text-eyebrow">RELATÓRIOS</span>
        <h1 className="mt-2 display-lg text-ink">Relatórios Personalizados</h1>
        <p className="mt-2 text-sm text-ink-mute">
          Selecione a entidade, escolha as colunas desejadas e exporte para Excel.
        </p>
      </header>
      <ReportBuilder userId={session.user.id} />
    </div>
  )
}
