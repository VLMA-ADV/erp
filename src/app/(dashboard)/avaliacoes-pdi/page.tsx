import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import Link from 'next/link'
import EquipeCard from '@/components/pdi/equipe-card'

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
          <CardTitle>Meu PDI {new Date().getFullYear()}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-ink-mute">
            Faça sua autoavaliação do ciclo: skills da carreira e DNA por faixa, metas semestrais e feedbacks mensais.
          </p>
          <Link
            href="/avaliacoes-pdi/meu"
            className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-deep"
          >
            Abrir meu PDI
          </Link>
        </CardContent>
      </Card>

      <EquipeCard />

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Catálogo do PDP</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-ink-mute">
            Base de referência do PDP 2026: carreiras, régua de avaliação, quadro de remuneração, matriz de skills e DNA.
          </p>
          <Link
            href="/avaliacoes-pdi/catalogo"
            className="inline-flex items-center rounded-md border border-hairline bg-card px-4 py-2 text-sm font-medium text-ink hover:bg-canvas-soft"
          >
            Ver catálogo do PDP
          </Link>
        </CardContent>
      </Card>
    </div>
  )
}
