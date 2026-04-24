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
    <div className="container mx-auto py-10">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Avaliações PDI</h1>
        <p className="mt-2 text-gray-600">Avaliações de desempenho individual do colaborador</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>PDI - Em Desenvolvimento</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-gray-600">
            A funcionalidade de visualização de PDI será implementada em uma próxima sprint.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
