'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { usePermissionsContext } from '@/lib/contexts/permissions-context'

export default function ColaboradoresPageClient() {
  const { hasPermission, permissions, loading } = usePermissionsContext()

  // Verificar se o usuário tem permissão para criar colaboradores
  const canCreate = hasPermission('people.colaboradores.write') || 
                    hasPermission('people.colaboradores.*')

  // Debug
  if (!loading) {
    console.log('ColaboradoresPageClient - Permissions:', permissions)
    console.log('ColaboradoresPageClient - canCreate:', canCreate)
    console.log('ColaboradoresPageClient - has people.colaboradores.write:', hasPermission('people.colaboradores.write'))
    console.log('ColaboradoresPageClient - has people.colaboradores.*:', hasPermission('people.colaboradores.*'))
  }

  return (
    <div className="mb-6 flex items-center justify-between">
      <div>
        <h1 className="text-3xl font-bold">Colaboradores</h1>
        <p className="mt-2 text-gray-600">Gerencie os colaboradores do sistema</p>
      </div>
      {canCreate && (
        <Link href="/pessoas/colaboradores/novo">
          <Button>Novo Colaborador</Button>
        </Link>
      )}
    </div>
  )
}
