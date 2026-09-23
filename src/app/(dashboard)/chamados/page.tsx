import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import ChamadosList from '@/components/chamados/chamados-list'

export const dynamic = 'force-dynamic'

// Central de chamados (Filipe, 22/09/2026): qualquer colaborador logado abre e
// acompanha; não há permissão de leitura — o gate é só estar no tenant.
export default async function ChamadosPage() {
  const supabase = await createClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session) redirect('/login')

  return (
    <div className="container mx-auto px-6 py-12">
      <header className="mb-8">
        <span className="text-eyebrow">SUPORTE</span>
        <h1 className="mt-2 display-lg text-ink">Central de chamados</h1>
        <p className="mt-2 text-sm text-ink-mute">
          Erros, sugestões e dúvidas sobre o ERP. Quem cuida do sistema responde por aqui.
        </p>
      </header>
      <ChamadosList />
    </div>
  )
}
