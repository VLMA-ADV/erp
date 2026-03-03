import { redirect } from 'next/navigation'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function NotasGeradasPage() {
  const supabase = await createClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session) redirect('/login')

  return (
    <div className="container mx-auto py-10">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Notas geradas</h1>
        <p className="mt-2 text-gray-600">Rastreie artefatos gerados no faturamento (boleto, relatório de honorários e NF).</p>
      </div>

      <Alert>
        <AlertTitle>Em implementação</AlertTitle>
        <AlertDescription>
          A tabela de notas já foi criada no banco. Esta tela será ligada aos registros gerados nas próximas tarefas da sprint.
        </AlertDescription>
      </Alert>
    </div>
  )
}
