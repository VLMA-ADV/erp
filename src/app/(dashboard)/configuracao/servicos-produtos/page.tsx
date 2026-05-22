import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import ServicosProdutosList from '@/components/configuracao/servicos-produtos-list'

export const dynamic = 'force-dynamic'

export default async function ServicosProdutosPage() {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()

  if (!session) redirect('/login')

  return (
    <div className="container mx-auto px-6 py-12">
      <header className="mb-8">
        <span className="text-eyebrow">CONFIGURAÇÃO</span>
        <h1 className="mt-2 display-lg text-ink">Produtos</h1>
        <p className="mt-2 text-sm text-ink-mute">Gerencie os produtos da empresa</p>
      </header>
      <ServicosProdutosList />
    </div>
  )
}
