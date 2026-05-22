import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default async function AvaliacoesPDIPage() {
  const supabase = await createClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session) redirect('/login')

  return (
    <div className="container mx-auto px-6 py-12">
      <header className="mb-8">
        <span className="text-eyebrow">PESSOAS</span>
        <h1 className="mt-2 display-lg text-ink">Avaliações PDI</h1>
        <p className="mt-2 text-sm text-ink-mute">
          Plano de Desenvolvimento Individual — avaliações de desempenho por colaborador.
        </p>
      </header>
      <Card>
        <CardHeader>
          <CardTitle>Em desenvolvimento</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-ink-mute">
            A listagem centralizada de avaliações PDI será implementada em uma próxima sprint.
          </p>
          <p className="text-sm text-ink-mute">
            Por enquanto, acesse o PDI de cada colaborador individualmente em{' '}
            <Link href="/pessoas/colaboradores" className="text-primary underline underline-offset-2">
              Pessoas → Colaboradores
            </Link>
            .
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
