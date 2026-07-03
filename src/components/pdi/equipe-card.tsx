'use client'

import Link from 'next/link'
import { usePermissionsContext } from '@/lib/contexts/permissions-context'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

// Card do hub /avaliacoes-pdi visível só para quem pode avaliar equipe (sócio/coordenador).
export default function EquipeCard() {
  const { hasPermission, loading, permissions } = usePermissionsContext()
  const pode = (!loading && permissions.length === 0) || hasPermission('people.pdi.write')
  if (!pode) return null

  return (
    <Card className="mt-4 border-brand-purple/25 bg-brand-purple-soft">
      <CardHeader>
        <CardTitle>Avaliação da equipe (gestor)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-ink-mute">
          Reveja as autoavaliações do time, atribua a faixa final por competência, valide as metas e aplique a
          progressão de cargo e salário.
        </p>
        <Link
          href="/avaliacoes-pdi/equipe"
          className="inline-flex items-center rounded-md bg-brand-purple px-4 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          Abrir avaliações da equipe
        </Link>
      </CardContent>
    </Card>
  )
}
