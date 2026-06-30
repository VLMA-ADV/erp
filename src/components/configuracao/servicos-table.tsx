'use client'

import { usePermissionsContext } from '@/lib/contexts/permissions-context'
import ServicosActions from './servicos-actions'
import { Table } from '@/components/ui/table'

interface Servico {
  id: string
  nome: string
}

interface ServicosTableProps {
  servicos: Servico[]
  loading: boolean
  onEdit: (servico: Servico) => void
  onRefresh: () => void
}

export default function ServicosTable({ servicos, loading, onEdit, onRefresh }: ServicosTableProps) {
  const { hasPermission } = usePermissionsContext()
  const canEdit = hasPermission('config.servicos.write')

  if (loading) {
    return (
      <div className="rounded-md border p-4">
        <div className="animate-pulse space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-12 rounded bg-secondary"></div>
          ))}
        </div>
      </div>
    )
  }

  if (servicos.length === 0) {
    return (
      <div className="rounded-md border p-8 text-center">
        <p className="text-ink-mute">Nenhum serviço encontrado</p>
      </div>
    )
  }

  return (
    <div className="rounded-md border overflow-x-auto">
      <Table className="w-full min-w-full">
        <thead className="bg-canvas-soft">
          <tr>
            <th className="px-6 py-3 text-left text-xs font-medium text-ink-mute uppercase tracking-wider">Nome</th>
            {canEdit && (
              <th className="px-6 py-3 text-right text-xs font-medium text-ink-mute uppercase tracking-wider">Ações</th>
            )}
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-hairline">
          {servicos.map((servico) => (
            <tr key={servico.id} className="hover:bg-canvas-soft">
              <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-ink">{servico.nome}</td>
              {canEdit && (
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                  <ServicosActions servico={servico} canEdit={canEdit} onEdit={onEdit} onRefresh={onRefresh} />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  )
}
