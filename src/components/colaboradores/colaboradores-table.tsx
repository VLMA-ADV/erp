'use client'

import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import ColaboradoresActions from './colaboradores-actions'
import { usePermissionsContext } from '@/lib/contexts/permissions-context'

interface Colaborador {
  id: string
  nome: string
  email: string
  whatsapp: string | null
  ativo: boolean
  cargo: {
    nome: string
  } | null
}

interface Pagination {
  page: number
  limit: number
  total: number
  totalPages: number
}

interface ColaboradoresTableProps {
  colaboradores: Colaborador[]
  loading: boolean
  pagination: Pagination
  onPageChange: (page: number) => void
  onRefresh: () => void
}

export default function ColaboradoresTable({
  colaboradores,
  loading,
  pagination,
  onPageChange,
  onRefresh,
}: ColaboradoresTableProps) {
  const router = useRouter()
  const { hasPermission, permissions, loading: permissionsLoading } = usePermissionsContext()

  // Verificar permissões corretamente
  const canEdit = hasPermission('people.colaboradores.write') || 
                  hasPermission('people.colaboradores.*')
  const canViewPDI = hasPermission('people.colaboradores.view_pdi') ||
                     hasPermission('people.pdi.read') ||
                     hasPermission('people.pdi.*')
  const canView = hasPermission('people.colaboradores.read') ||
                  hasPermission('people.colaboradores.*')
  
  // A coluna "Ações" só deve aparecer se o usuário tiver permissões além de apenas visualizar
  // Se só tiver permissão de visualizar, não mostra a coluna de ações
  const hasAnyAction = canEdit || canViewPDI

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

  if (colaboradores.length === 0) {
    return (
      <div className="rounded-md border p-8 text-center">
        <p className="text-gray-500">Nenhum colaborador encontrado</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md border overflow-x-auto">
        <table className="w-full min-w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Nome
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                E-mail
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                WhatsApp
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Cargo
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
            {colaboradores.map((colaborador) => (
              <tr key={colaborador.id} className="hover:bg-gray-50">
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                  {colaborador.nome}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {colaborador.email}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {colaborador.whatsapp || '-'}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {colaborador.cargo?.nome || '-'}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span
                    className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                      colaborador.ativo
                        ? 'bg-green-100 text-green-800'
                        : 'bg-red-100 text-red-800'
                    }`}
                  >
                    {colaborador.ativo ? 'Ativo' : 'Inativo'}
                  </span>
                </td>
                {hasAnyAction && (
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <ColaboradoresActions
                      colaborador={colaborador}
                      canEdit={canEdit}
                      canView={canView}
                      canViewPDI={canViewPDI}
                      onRefresh={onRefresh}
                    />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <div className="text-sm text-gray-700">
            Mostrando {((pagination.page - 1) * pagination.limit) + 1} a{' '}
            {Math.min(pagination.page * pagination.limit, pagination.total)} de{' '}
            {pagination.total} resultados
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPageChange(pagination.page - 1)}
              disabled={pagination.page === 1}
            >
              Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPageChange(pagination.page + 1)}
              disabled={pagination.page >= pagination.totalPages}
            >
              Próxima
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
