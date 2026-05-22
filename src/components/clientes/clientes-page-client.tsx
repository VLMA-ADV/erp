'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { usePermissionsContext } from '@/lib/contexts/permissions-context'

export default function ClientesPageClient() {
  const { hasPermission } = usePermissionsContext()

  const canCreate =
    hasPermission('crm.clientes.write')

  return (
    <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <span className="text-eyebrow">Pessoas</span>
        <h1 className="mt-2 display-lg text-ink">Clientes</h1>
        <p className="mt-2 text-sm text-ink-mute">Gerencie os clientes do escritório.</p>
      </div>
      {canCreate && (
        <Link href="/pessoas/clientes/novo">
          <Button size="lg">Novo cliente</Button>
        </Link>
      )}
    </header>
  )
}
