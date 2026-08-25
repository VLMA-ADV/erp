import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import CobrancaBoletoForm from '@/components/configuracao/cobranca-boleto-form'

export const dynamic = 'force-dynamic'

export default async function CobrancaPage() {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) redirect('/login')

  return (
    <div className="container mx-auto px-6 py-12">
      <header className="mb-8">
        <span className="text-eyebrow">CONFIGURAÇÃO</span>
        <h1 className="mt-2 display-lg text-ink">Cobrança por boleto</h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-mute">
          Como os boletos do escritório são emitidos no Itaú: de qual conta saem, o que se cobra de quem atrasa e
          quem entrega o documento ao cliente.
        </p>
      </header>
      <CobrancaBoletoForm />
    </div>
  )
}
