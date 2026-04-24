'use client'

import Link from 'next/link'
import { usePermissionsContext } from '@/lib/contexts/permissions-context'
import ParceirosActions from './parceiros-actions'
import type { ParceiroListItem } from './parceiros-list'
import { Table } from '@/components/ui/table'
import { maskCNPJ } from '@/lib/utils/masks'

export default function ParceirosTable({
  items,
  loading,
  onRefresh,
}: {
  items: ParceiroListItem[]
  loading: boolean
  onRefresh: () => void
}) {
  const { hasPermission } = usePermissionsContext()
  const canEdit =
    hasPermission('people.parceiros.write')

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

  if (items.length === 0) {
    return (
      <div className="rounded-md border p-8 text-center">
        <p className="text-gray-500">Nenhum parceiro encontrado</p>
      </div>
    )
  }

  return (
    <div className="rounded-md border overflow-x-auto">
      <Table className="w-full min-w-full">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Nome
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              CNPJ
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Cidade/UF
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Status
            </th>
            {canEdit && (
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Ações
              </th>
            )}
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {items.map((p) => (
            <tr key={p.id} className="hover:bg-gray-50">
              <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                <Link
                  href={`/pessoas/parceiros/${p.id}/editar`}
                  className="hover:underline"
                >
                  {p.nome_escritorio}
                </Link>
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                {maskCNPJ(p.cnpj || '')}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                {[p.cidade, p.estado].filter(Boolean).join(' / ') || '-'}
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <span
                  className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                    p.ativo
                      ? 'bg-green-100 text-green-800'
                      : 'bg-red-100 text-red-800'
                  }`}
                >
                  {p.ativo ? 'Ativo' : 'Inativo'}
                </span>
              </td>
              {canEdit && (
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                  <ParceirosActions parceiro={p} onRefresh={onRefresh} />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  )
}
