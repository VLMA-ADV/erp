'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { usePermissionsContext } from '@/lib/contexts/permissions-context'

export default function ParceirosPageClient() {
  const { hasPermission } = usePermissionsContext()

  const canCreate =
    hasPermission('people.parceiros.write') || hasPermission('people.parceiros.*')

  return (
    <div className="mb-6 flex items-center justify-between">
      <div>
        <h1 className="text-3xl font-bold">Parceiros</h1>
        <p className="mt-2 text-gray-600">Gerencie os parceiros (escritorios externos)</p>
      </div>
      {canCreate && (
        <Link href="/pessoas/parceiros/novo">
          <Button>Novo Parceiro</Button>
        </Link>
      )}
    </div>
  )
}

