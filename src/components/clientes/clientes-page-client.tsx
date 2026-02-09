'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { usePermissionsContext } from '@/lib/contexts/permissions-context'

export default function ClientesPageClient() {
  const { hasPermission } = usePermissionsContext()

  const canCreate =
    hasPermission('crm.clientes.write') || hasPermission('crm.clientes.*')

  return (
    <div className="mb-6 flex items-center justify-between">
      <div>
        <h1 className="text-3xl font-bold">Clientes</h1>
        <p className="mt-2 text-gray-600">Gerencie os clientes</p>
      </div>
      {canCreate && (
        <Link href="/pessoas/clientes/novo">
          <Button>Novo Cliente</Button>
        </Link>
      )}
    </div>
  )
}

