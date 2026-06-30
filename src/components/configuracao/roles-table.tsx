'use client'

import RolesActions from './roles-actions'
import { usePermissionsContext } from '@/lib/contexts/permissions-context'
import { Table } from '@/components/ui/table'

interface Role {
  id: string
  nome: string
  descricao: string | null
  ativo: boolean
}

interface RolesTableProps {
  roles: Role[]
  loading: boolean
  onEdit: (role: Role) => void | Promise<void>
  onView: (role: Role) => void | Promise<void>
  onRefresh: () => void
}

export default function RolesTable({
  roles,
  loading,
  onEdit,
  onView,
  onRefresh,
}: RolesTableProps) {
  const { hasPermission } = usePermissionsContext()

  const canEdit = hasPermission('config.roles.write')
  const canView = hasPermission('config.roles.read')
  const hasAnyAction = canEdit || canView

  if (loading) {
    return (
      <div className="rounded-md border p-4">
        <div className="animate-pulse space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-12 bg-secondary rounded"></div>
          ))}
        </div>
      </div>
    )
  }

  if (roles.length === 0) {
    return (
      <div className="rounded-md border p-8 text-center">
        <p className="text-ink-mute">Nenhuma role encontrada</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md border overflow-x-auto">
        <Table className="w-full min-w-full">
          <thead className="bg-canvas-soft">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-ink-mute uppercase tracking-wider">
                Nome
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-ink-mute uppercase tracking-wider">
                Descrição
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-ink-mute uppercase tracking-wider">
                Status
              </th>
              {hasAnyAction && (
                <th className="px-6 py-3 text-right text-xs font-medium text-ink-mute uppercase tracking-wider">
                  Ações
                </th>
              )}
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-hairline">
            {roles.map((role) => (
              <tr key={role.id} className="hover:bg-canvas-soft">
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-ink">
                  {role.nome}
                </td>
                <td className="px-6 py-4 text-sm text-ink-mute">
                  {role.descricao || '-'}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span
                    className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                      role.ativo
                        ? 'bg-green-100 text-green-800'
                        : 'bg-red-100 text-red-800'
                    }`}
                  >
                    {role.ativo ? 'Ativo' : 'Inativo'}
                  </span>
                </td>
                {hasAnyAction && (
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <RolesActions
                      role={role}
                      canEdit={canEdit}
                      canView={canView}
                      onEdit={onEdit}
                      onView={onView}
                      onRefresh={onRefresh}
                    />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
    </div>
  )
}
