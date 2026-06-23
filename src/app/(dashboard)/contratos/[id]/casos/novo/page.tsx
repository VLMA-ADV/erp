import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import CasoForm from '@/components/contratos/caso-form'
import DuplicarCasoButton from '@/components/contratos/duplicar-caso-button'

export const dynamic = 'force-dynamic'

export default async function NovoCasoPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()

  if (!session) redirect('/login')

  return (
    <div className="container mx-auto px-6 py-12">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <span className="text-eyebrow">OPERAÇÃO</span>
          <h1 className="mt-2 display-lg text-ink">Novo Caso</h1>
          <p className="mt-2 text-sm text-ink-mute">Cadastre um novo caso para o contrato</p>
        </div>
        <DuplicarCasoButton contratoIdAtual={id} />
      </header>
      <CasoForm contratoId={id} />
    </div>
  )
}
