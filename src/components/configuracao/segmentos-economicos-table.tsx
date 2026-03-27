'use client'

import SegmentosEconomicosActions from './segmentos-economicos-actions'
import { usePermissionsContext } from '@/lib/contexts/permissions-context'
import { Table } from '@/components/ui/table'

interface SegmentoEconomico {
  id: string
  nome: string
  ativo: boolean
}

interface SegmentosEconomicosTableProps {
  segmentos: SegmentoEconomico[]
  loading: boolean
  onEdit: (segmento: SegmentoEconomico) => void
  onRefresh: () => void
}

export default function SegmentosEconomicosTable({
  segmentos,
  loading,
  onEdit,
  onRefresh,
}: SegmentosEconomicosTableProps) {
  const { hasPermission } = usePermissionsContext()

  const canEdit = hasPermission('config.segmentos.write')
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

  if (segmentos.length === 0) {
    return (
      <div className="rounded-md border p-8 text-center">
        <p className="text-gray-500">Nenhum segmento econômico encontrado</p>
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
            {segmentos.map((segmento) => (
              <tr key={segmento.id} className="hover:bg-gray-50">
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                  {segmento.nome}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span
                    className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                      segmento.ativo
                        ? 'bg-green-100 text-green-800'
                        : 'bg-red-100 text-red-800'
                    }`}
                  >
                    {segmento.ativo ? 'Ativo' : 'Inativo'}
                  </span>
                </td>
                {hasAnyAction && (
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <SegmentosEconomicosActions
                      segmento={segmento}
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
