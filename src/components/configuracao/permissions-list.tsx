'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { usePermissionsContext } from '@/lib/contexts/permissions-context'

interface Permission {
  id: string
  chave: string
  descricao: string
  categoria: string
}

export default function PermissionsList() {
  const { hasPermission } = usePermissionsContext()
  const [permissions, setPermissions] = useState<Record<string, Permission[]>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const canRead = hasPermission('config.permissions.read')

  useEffect(() => {
    if (canRead) {
      fetchPermissions()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canRead])

  const fetchPermissions = async () => {
    try {
      setLoading(true)
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()

      if (!session) return

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-permissions`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
        }
      )

      if (response.ok) {
        const data = await response.json()
        setPermissions(data.data || {})
      } else {
        const errorData = await response.json()
        setError(errorData.error || 'Erro ao carregar permissões')
      }
    } catch (err) {
      console.error('Error fetching permissions:', err)
      setError('Erro ao carregar permissões')
    } finally {
      setLoading(false)
    }
  }

  if (!canRead) {
    return (
      <div className="rounded-md bg-red-50 p-4">
        <p className="text-sm text-red-800">Você não tem permissão para visualizar permissões</p>
      </div>
    )
  }

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

  const getCategoryLabel = (categoria: string) => {
    const labels: Record<string, string> = {
      dashboard: 'Dashboard',
      crm: 'CRM',
      people: 'Pessoas',
      contracts: 'Contratos',
      operations: 'Operações',
      finance: 'Financeiro',
      reports: 'Relatórios',
      config: 'Configuração',
    }
    return labels[categoria] || categoria
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-md bg-red-50 p-4">
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Permissões do Sistema</CardTitle>
        </CardHeader>
        <CardContent>
          {Object.keys(permissions).length === 0 ? (
            <p className="text-gray-500 text-center py-8">Nenhuma permissão cadastrada</p>
          ) : (
            <div className="space-y-6">
              {Object.entries(permissions).map(([categoria, perms]) => (
                <div key={categoria} className="space-y-2">
                  <h3 className="text-lg font-semibold text-gray-900">
                    {getCategoryLabel(categoria)}
                  </h3>
                  <div className="ml-4 space-y-2">
                    {perms.map((perm) => (
                      <div
                        key={perm.id}
                        className="flex items-center justify-between p-3 border rounded-lg hover:bg-gray-50"
                      >
                        <div>
                          <p className="font-medium text-gray-900">{perm.chave}</p>
                          {perm.descricao && (
                            <p className="text-sm text-gray-500">{perm.descricao}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
