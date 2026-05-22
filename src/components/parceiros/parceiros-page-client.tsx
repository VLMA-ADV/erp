'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { usePermissionsContext } from '@/lib/contexts/permissions-context'

export default function ParceirosPageClient() {
  const { hasPermission } = usePermissionsContext()

  const canCreate =
    hasPermission('people.parceiros.write')

  return (
    <div className="mb-6 flex items-center justify-between">
      <div>
        <h1 className="display-lg text-ink">Parceiros</h1>
        <p className="mt-2 text-ink-mute">Gerencie os parceiros (escritorios externos)</p>
      </div>
      {canCreate && (
        <Link href="/pessoas/parceiros/novo">
          <Button>Novo Parceiro</Button>
        </Link>
      )}
    </div>
  )
}

