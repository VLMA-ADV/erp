import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export const dynamic = 'force-dynamic'

export default async function RelatoriosPage() {
  const supabase = await createClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session) redirect('/login')

  return (
    <div className="container mx-auto px-6 py-12">
      <header className="mb-8">
        <span className="text-eyebrow">RELATÓRIOS</span>
        <h1 className="mt-2 display-lg text-ink">Relatórios</h1>
        <p className="mt-2 text-sm text-ink-mute">
          Geração e exportação de relatórios operacionais e financeiros.
        </p>
      </header>
      <Card>
        <CardHeader>
          <CardTitle>Em desenvolvimento</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-ink-mute">
            O módulo de relatórios (timesheet, faturamento, contratos, avaliações PDI) será
            implementado em uma próxima sprint.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
