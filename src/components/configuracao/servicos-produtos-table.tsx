'use client'

import { usePermissionsContext } from '@/lib/contexts/permissions-context'
import ServicosProdutosActions from './servicos-produtos-actions'
import { Table } from '@/components/ui/table'

interface ServicoProduto {
  id: string
  nome: string
}

interface ServicosProdutosTableProps {
  servicosProdutos: ServicoProduto[]
  loading: boolean
  onEdit: (servicoProduto: ServicoProduto) => void
}

export default function ServicosProdutosTable({ servicosProdutos, loading, onEdit }: ServicosProdutosTableProps) {
  const { hasPermission } = usePermissionsContext()
  const canEdit = hasPermission('config.produtos.write') || hasPermission('config.produtos.*')

  if (loading) {
    return (
      <div className="rounded-md border p-4">
        <div className="animate-pulse space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-12 rounded bg-gray-200"></div>
          ))}
        </div>
      </div>
    )
  }

  if (servicosProdutos.length === 0) {
    return (
      <div className="rounded-md border p-8 text-center">
        <p className="text-gray-500">Nenhum produto encontrado</p>
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
          {servicosProdutos.map((servicoProduto) => (
            <tr key={servicoProduto.id} className="hover:bg-gray-50">
              <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{servicoProduto.nome}</td>
              {canEdit && (
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                  <ServicosProdutosActions servicoProduto={servicoProduto} canEdit={canEdit} onEdit={onEdit} />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  )
}
