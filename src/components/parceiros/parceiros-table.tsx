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
            <div key={i} className="h-12 rounded bg-secondary"></div>
          ))}
        </div>
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="rounded-md border p-8 text-center">
        <p className="text-ink-mute">Nenhum parceiro encontrado</p>
      </div>
    )
  }

  return (
    <div className="rounded-md border overflow-x-auto">
      <Table className="w-full min-w-full">
        <thead className="bg-canvas-soft">
          <tr>
            <th className="px-6 py-3 text-left text-xs font-medium text-ink-mute uppercase tracking-wider">
              Nome
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-ink-mute uppercase tracking-wider">
              CNPJ
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-ink-mute uppercase tracking-wider">
              Cidade/UF
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-ink-mute uppercase tracking-wider">
              Status
            </th>
            {canEdit && (
              <th className="px-6 py-3 text-right text-xs font-medium text-ink-mute uppercase tracking-wider">
                Ações
              </th>
            )}
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-hairline">
          {items.map((p) => (
            <tr key={p.id} className="hover:bg-canvas-soft">
              <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-ink">
                <Link
                  href={`/pessoas/parceiros/${p.id}/editar`}
                  className="hover:underline"
                >
                  {p.nome_escritorio}
                </Link>
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-ink-mute">
                {maskCNPJ(p.cnpj || '')}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-ink-mute">
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
