'use client'

import { usePermissionsContext } from '@/lib/contexts/permissions-context'
import { Table } from '@/components/ui/table'
import CategoriasPrestadoresParceirosActions from './categorias-prestadores-parceiros-actions'

export interface CategoriaPrestadorParceiroItem {
  id: string
  nome: string
  ativo: boolean
}

export default function CategoriasPrestadoresParceirosTable({
  items,
  loading,
  onEdit,
}: {
  items: CategoriaPrestadorParceiroItem[]
  loading: boolean
  onEdit: (item: CategoriaPrestadorParceiroItem) => void
}) {
  const { hasPermission } = usePermissionsContext()
  const canEdit =
    hasPermission('config.categorias_prestadores_parceiros.write') ||
    hasPermission('config.categorias_prestadores_parceiros.*')

  if (loading) {
    return (
      <div className="rounded-md border p-4">
        <div className="animate-pulse space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-12 rounded bg-gray-200" />
          ))}
        </div>
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="rounded-md border p-8 text-center">
        <p className="text-gray-500">Nenhuma categoria encontrada</p>
      </div>
    )
  }

  return (
    <div className="rounded-md border overflow-x-auto">
      <Table className="w-full min-w-full">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Nome</th>
            {canEdit && (
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Ações</th>
            )}
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {items.map((item) => (
            <tr key={item.id} className="hover:bg-gray-50">
              <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{item.nome}</td>
              {canEdit && (
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                  <CategoriasPrestadoresParceirosActions item={item} canEdit={canEdit} onEdit={onEdit} />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  )
}
