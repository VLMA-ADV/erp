'use client'

import GruposEconomicosActions from './grupos-economicos-actions'
import { usePermissionsContext } from '@/lib/contexts/permissions-context'
import { Table } from '@/components/ui/table'

interface GrupoEconomico {
  id: string
  nome: string
  ativo: boolean
}

interface GruposEconomicosTableProps {
  grupos: GrupoEconomico[]
  loading: boolean
  onEdit: (grupo: GrupoEconomico) => void
  onRefresh: () => void
}

export default function GruposEconomicosTable({
  grupos,
  loading,
  onEdit,
  onRefresh,
}: GruposEconomicosTableProps) {
  const { hasPermission } = usePermissionsContext()

  const canEdit = hasPermission('config.grupos.write')
  const hasAnyAction = canEdit

  if (loading) {
    return (
      <div className="rounded-md border p-4">
        <div className="animate-pulse space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-12 bg-gray-200 rounded"></div>
          ))}
        </div>
      </div>
    )
  }

  if (grupos.length === 0) {
    return (
      <div className="rounded-md border p-8 text-center">
        <p className="text-gray-500">Nenhum grupo econômico encontrado</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md border overflow-x-auto">
        <Table className="w-full min-w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Nome
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Status
              </th>
              {hasAnyAction && (
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Ações
                </th>
              )}
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {grupos.map((grupo) => (
              <tr key={grupo.id} className="hover:bg-gray-50">
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                  {grupo.nome}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span
                    className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                      grupo.ativo
                        ? 'bg-green-100 text-green-800'
                        : 'bg-red-100 text-red-800'
                    }`}
                  >
                    {grupo.ativo ? 'Ativo' : 'Inativo'}
                  </span>
                </td>
                {hasAnyAction && (
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <GruposEconomicosActions
                      grupo={grupo}
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
