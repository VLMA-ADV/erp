'use client'

import Link from 'next/link'
import { usePermissionsContext } from '@/lib/contexts/permissions-context'
import PrestadoresActions from './prestadores-actions'
import type { PrestadorListItem } from './prestadores-list'
import { Table } from '@/components/ui/table'
import { maskCpfCnpj } from '@/lib/utils/masks'

export default function PrestadoresTable({
  items,
  loading,
  onRefresh,
  basePath = '/pessoas/prestadores',
  entityLabel = 'prestador',
  permissionPrefixes = ['people.prestadores'],
  nameField = 'nome_prestador',
  toggleEndpoint = 'toggle-prestador-status',
}: {
  items: PrestadorListItem[]
  loading: boolean
  onRefresh: () => void
  basePath?: string
  entityLabel?: string
  permissionPrefixes?: string[]
  nameField?: 'nome_prestador' | 'nome_fornecedor'
  toggleEndpoint?: string
}) {
  const { hasPermission } = usePermissionsContext()
  const canEdit =
    permissionPrefixes.some((prefix) =>
      hasPermission(`${prefix}.write`) || hasPermission(`${prefix}.*`)
    ) ||
    hasPermission('people.*') ||
    hasPermission('*')

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
        <p className="text-gray-500">Nenhum {entityLabel} encontrado</p>
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
              CPF/CNPJ
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Recorrente
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
                  href={`${basePath}/${p.id}/editar`}
                  className="hover:underline"
                >
                  {(p as any)[nameField] || p.nome_prestador || p.nome_fornecedor}
                </Link>
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                {maskCpfCnpj(p.cpf_cnpj || '', p.tipo_documento || undefined)}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                {p.servico_recorrente ? `Sim (${p.valor_recorrente ?? '-'})` : 'Não'}
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
                  <PrestadoresActions
                    prestador={p}
                    onRefresh={onRefresh}
                    basePath={basePath}
                    entityLabel={entityLabel}
                    toggleEndpoint={toggleEndpoint}
                  />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  )
}
