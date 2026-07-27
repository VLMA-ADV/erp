import { redirect } from 'next/navigation'
import RevisaoDeFaturaList from '@/components/faturamento/revisao-de-fatura-list'
import GerarFaturamentoMesButton from '@/components/faturamento/gerar-faturamento-mes-button'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function RevisaoDeFaturaPage() {
  const supabase = await createClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session) redirect('/login')

  return (
    <div className="container mx-auto px-6 py-12">
      {/* Fase 2a da tela única: "Gerar faturamento do mês" passa a viver no topo da
          revisão (base da consolidação). A lista já faz refetch silencioso no foco/
          visibilitychange, então os itens gerados aparecem aqui sem trocar de página. */}
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <span className="text-eyebrow">FINANCEIRO</span>
          <h1 className="mt-2 display-lg text-ink">Revisão de fatura</h1>
          <p className="mt-2 text-sm text-ink-mute">Revisão de snapshot por caso e regra financeira antes da aprovação.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <GerarFaturamentoMesButton redirectAfterSuccess={false} />
        </div>
      </header>
      <RevisaoDeFaturaList />
    </div>
  )
}
