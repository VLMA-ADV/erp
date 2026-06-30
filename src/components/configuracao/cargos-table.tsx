'use client'

import { Button } from '@/components/ui/button'
import CargosActions from './cargos-actions'
import { usePermissionsContext } from '@/lib/contexts/permissions-context'
import { Table } from '@/components/ui/table'

interface Cargo {
  id: string
  nome: string
  codigo: string
  nivel?: number | null
  ativo: boolean
}

interface CargosTableProps {
  cargos: Cargo[]
  loading: boolean
  onEdit: (cargo: Cargo) => void
  onRefresh: () => void
}

export default function CargosTable({
  cargos,
  loading,
  onEdit,
  onRefresh,
}: CargosTableProps) {
  const { hasPermission } = usePermissionsContext()

  const canEdit = hasPermission('config.cargos.write')
  const hasAnyAction = canEdit

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

  if (cargos.length === 0) {
    return (
      <div className="rounded-md border p-8 text-center">
        <p className="text-ink-mute">Nenhum cargo encontrado</p>
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
                Código
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-ink-mute uppercase tracking-wider">
                Nível
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
            {cargos.map((cargo) => (
              <tr key={cargo.id} className="hover:bg-canvas-soft">
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-ink">
                  {cargo.nome}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-ink-mute">
                  {cargo.codigo}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-ink-mute">
                  {cargo.nivel || '-'}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span
                    className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                      cargo.ativo
                        ? 'bg-green-100 text-green-800'
                        : 'bg-red-100 text-red-800'
                    }`}
                  >
                    {cargo.ativo ? 'Ativo' : 'Inativo'}
                  </span>
                </td>
                {hasAnyAction && (
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <CargosActions
                      cargo={cargo}
                      canEdit={canEdit}
                      onEdit={onEdit}
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
