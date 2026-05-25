import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export const dynamic = 'force-dynamic'

export default async function ColaboradorPDIPage({
  params,
}: {
  params: { id: string }
}) {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()

  if (!session) {
    redirect('/login')
  }

  return (
    <div className="container mx-auto px-6 py-12">
      <header className="mb-8">
        <span className="text-eyebrow">PESSOAS</span>
        <h1 className="mt-2 display-lg text-ink">Avaliações PDI</h1>
        <p className="mt-2 text-sm text-ink-mute">Avaliações de desempenho individual do colaborador</p>
      </header>
      <Card>
        <CardHeader>
          <CardTitle>PDI - Em Desenvolvimento</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-ink-mute">
            A funcionalidade de visualização de PDI será implementada em uma próxima sprint.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
