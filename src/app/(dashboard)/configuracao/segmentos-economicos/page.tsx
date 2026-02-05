import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default async function SegmentosEconomicosPage() {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()

  if (!session) {
    redirect('/login')
  }

  return (
    <div className="container mx-auto py-10">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Segmentos Econômicos</h1>
        <p className="mt-2 text-gray-600">Gerencie os segmentos econômicos para classificação de clientes</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Segmentos Econômicos</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-gray-500">Funcionalidade em desenvolvimento...</p>
        </CardContent>
      </Card>
    </div>
  )
}
