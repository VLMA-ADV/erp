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
    <div className="container mx-auto py-10">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Avaliações PDI</h1>
        <p className="mt-2 text-gray-600">
          Plano de Desenvolvimento Individual — avaliações de desempenho por colaborador.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Em desenvolvimento</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-gray-600">
            A listagem centralizada de avaliações PDI será implementada em uma próxima sprint.
          </p>
          <p className="text-gray-600">
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
