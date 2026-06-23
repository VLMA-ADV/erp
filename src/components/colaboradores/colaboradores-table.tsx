'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import ColaboradoresActions from './colaboradores-actions'
import { usePermissionsContext } from '@/lib/contexts/permissions-context'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/ui/toast'
import { Table } from '@/components/ui/table'

interface Colaborador {
  id: string
  nome: string
  email: string
  whatsapp: string | null
  ativo: boolean
  cargo: {
    nome: string
  } | null
  foto_url?: string | null
  salario?: number | null
}

function initials(nome: string) {
  const parts = (nome || '').trim().split(/\s+/)
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?'
}

function formatSalario(valor: number | null | undefined) {
  if (valor == null) return '-'
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(valor))
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
  const { success, error: toastError } = useToast()
  const { hasPermission, permissions, loading: permissionsLoading } = usePermissionsContext()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pendingIdRef = useRef<string | null>(null)
  const [uploadingId, setUploadingId] = useState<string | null>(null)

  const openFotoPicker = (id: string) => {
    pendingIdRef.current = id
    fileInputRef.current?.click()
  }

  const toBase64 = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.readAsDataURL(file)
      reader.onload = () => {
        const result = String(reader.result || '')
        resolve(result.includes(',') ? result.split(',')[1] : result)
      }
      reader.onerror = reject
    })

  const handleFotoSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    const colaboradorId = pendingIdRef.current
    event.target.value = ''
    if (!file || !colaboradorId) return
    if (!file.type.startsWith('image/')) {
      toastError('Selecione um arquivo de imagem')
      return
    }
    try {
      setUploadingId(colaboradorId)
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return
      const base64 = await toBase64(file)
      const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/upload-colaborador-foto`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          ...(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY } : {}),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ colaborador_id: colaboradorId, arquivo_base64: base64, mime_type: file.type }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        toastError(payload.error || 'Erro ao enviar a foto')
        return
      }
      success('Foto atualizada')
      onRefresh()
    } catch (err) {
      console.error(err)
      toastError('Erro ao enviar a foto')
    } finally {
      setUploadingId(null)
    }
  }

  // Verificar permissões corretamente
  const canEdit = hasPermission('people.colaboradores.write')
  const canViewPDI =
    hasPermission('people.colaboradores.view_pdi') || hasPermission('people.pdi.read')
  const canView = hasPermission('people.colaboradores.read')
  
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
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFotoSelected}
      />
      <div className="rounded-md border overflow-x-auto">
        <Table className="w-full min-w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Foto
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Nome
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                E-mail
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Cargo
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Salário
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
                <td className="px-4 py-3 whitespace-nowrap">
                  {(() => {
                    const avatar = colaborador.foto_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={colaborador.foto_url}
                        alt={colaborador.nome}
                        className="h-9 w-9 rounded-full object-cover"
                      />
                    ) : (
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-200 text-xs font-medium text-gray-600">
                        {initials(colaborador.nome)}
                      </div>
                    )
                    if (!canEdit) return avatar
                    return (
                      <button
                        type="button"
                        onClick={() => openFotoPicker(colaborador.id)}
                        disabled={uploadingId === colaborador.id}
                        title="Trocar foto"
                        className="relative rounded-full ring-offset-2 transition hover:ring-2 hover:ring-primary disabled:opacity-50"
                      >
                        {avatar}
                        {uploadingId === colaborador.id ? (
                          <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 text-[10px] text-white">...</span>
                        ) : null}
                      </button>
                    )
                  })()}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                  {colaborador.nome}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {colaborador.email}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {colaborador.cargo?.nome || '-'}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-tabular text-gray-700">
                  {formatSalario(colaborador.salario)}
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
        </Table>
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
