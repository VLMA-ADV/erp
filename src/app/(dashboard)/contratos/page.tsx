import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import ContratosList from '@/components/contratos/contratos-list'
import ContratosDashboard from '@/components/contratos/contratos-dashboard'
import InboxFlutuante from '@/components/contratos/inbox-flutuante'
import { SectionTabs } from '@/components/ui/section-tabs'

export const dynamic = 'force-dynamic'

export default async function ContratosPage() {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()

  if (!session) redirect('/login')

  return (
    <div className="container mx-auto px-6 py-12">
      <header className="mb-8">
        <span className="text-eyebrow">Operação</span>
        <h1 className="mt-2 display-lg text-ink">Contratos</h1>
        <p className="mt-2 text-sm text-ink-mute">Gerencie contratos e seus casos vinculados.</p>
      </header>
      <SectionTabs
        tabs={[
          { value: 'contratos', label: 'Contratos', content: <ContratosList /> },
          { value: 'visao', label: 'Visão geral', content: <ContratosDashboard /> },
        ]}
      />

      {/* A caixa de entrada saiu da aba e virou ícone (Filipe 07/08): ele quer
          ver de longe que chegou coisa. Ficam só as duas categorias que ele
          pediu — solicitações e mensagens. */}
      <InboxFlutuante />
    </div>
  )
}
