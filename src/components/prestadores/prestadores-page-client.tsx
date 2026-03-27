'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { usePermissionsContext } from '@/lib/contexts/permissions-context'

export default function PrestadoresPageClient({
  title = 'Prestadores de Serviço',
  description = 'Gerencie os prestadores de serviço',
  createLabel = 'Novo Prestador',
  basePath = '/pessoas/prestadores',
  permissionPrefixes = ['people.prestadores'],
}: {
  title?: string
  description?: string
  createLabel?: string
  basePath?: string
  permissionPrefixes?: string[]
}) {
  const { hasPermission } = usePermissionsContext()

  const canCreate = permissionPrefixes.some((prefix) => hasPermission(`${prefix}.write`))

  return (
    <div className="mb-6 flex items-center justify-between">
      <div>
        <h1 className="text-3xl font-bold">{title}</h1>
        <p className="mt-2 text-gray-600">{description}</p>
      </div>
      {canCreate && (
        <Link href={`${basePath}/novo`}>
          <Button>{createLabel}</Button>
        </Link>
      )}
    </div>
  )
}
