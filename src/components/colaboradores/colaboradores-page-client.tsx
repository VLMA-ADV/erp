'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { usePermissionsContext } from '@/lib/contexts/permissions-context'

export default function ColaboradoresPageClient() {
  const { hasPermission } = usePermissionsContext()

  const canCreate = hasPermission('people.colaboradores.write')

  return (
    <div className="mb-6 flex items-center justify-between">
      <div>
        <h1 className="display-lg text-ink">Colaboradores</h1>
        <p className="mt-2 text-ink-mute">Gerencie os colaboradores do sistema</p>
      </div>
      {canCreate && (
        <Link href="/pessoas/colaboradores/novo">
          <Button>Novo Colaborador</Button>
        </Link>
      )}
    </div>
  )
}
