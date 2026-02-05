'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { usePermissionsContext } from '@/lib/contexts/permissions-context'
import { Plus, Edit, Trash2 } from 'lucide-react'

interface Role {
  id: string
  nome: string
  descricao: string | null
  ativo: boolean
  created_at: string
}

export default function RolesList() {
  const { hasPermission } = usePermissionsContext()
  const [roles, setRoles] = useState<Role[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [newRole, setNewRole] = useState({ nome: '', descricao: '' })
  const [editRole, setEditRole] = useState({ nome: '', descricao: '' })

  const canWrite = hasPermission('config.roles.write') || hasPermission('config.roles.*')
  const canRead = hasPermission('config.roles.read') || hasPermission('config.roles.*')

  useEffect(() => {
    if (canRead) {
      fetchRoles()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canRead])

  const fetchRoles = async () => {
    try {
      setLoading(true)
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()

      if (!session) return

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-roles`,
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
        setRoles(data.data || [])
      } else {
        const errorData = await response.json()
        setError(errorData.error || 'Erro ao carregar roles')
      }
    } catch (err) {
      console.error('Error fetching roles:', err)
      setError('Erro ao carregar roles')
    } finally {
      setLoading(false)
    }
  }

  const handleCreate = async () => {
    if (!newRole.nome.trim()) {
      setError('Nome da role é obrigatório')
      return
    }

    try {
      // TODO: Criar Edge Function para criar role
      alert('Funcionalidade de criar role será implementada em breve')
      setNewRole({ nome: '', descricao: '' })
    } catch (err) {
      console.error('Error creating role:', err)
      setError('Erro ao criar role')
    }
  }

  const handleEdit = (role: Role) => {
    setEditingId(role.id)
    setEditRole({ nome: role.nome, descricao: role.descricao || '' })
  }

  const handleSaveEdit = async (id: string) => {
    if (!editRole.nome.trim()) {
      setError('Nome da role é obrigatório')
      return
    }

    try {
      // TODO: Criar Edge Function para atualizar role
      alert('Funcionalidade de editar role será implementada em breve')
      setEditingId(null)
      setEditRole({ nome: '', descricao: '' })
      fetchRoles()
    } catch (err) {
      console.error('Error updating role:', err)
      setError('Erro ao atualizar role')
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Tem certeza que deseja excluir esta role?')) {
      return
    }

    try {
      // TODO: Criar Edge Function para deletar role
      alert('Funcionalidade de deletar role será implementada em breve')
      fetchRoles()
    } catch (err) {
      console.error('Error deleting role:', err)
      setError('Erro ao excluir role')
    }
  }

  if (!canRead) {
    return (
      <div className="rounded-md bg-red-50 p-4">
        <p className="text-sm text-red-800">Você não tem permissão para visualizar roles</p>
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

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-md bg-red-50 p-4">
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      {canWrite && (
        <Card>
          <CardHeader>
            <CardTitle>Nova Role</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Nome *
                </label>
                <Input
                  value={newRole.nome}
                  onChange={(e) => setNewRole({ ...newRole, nome: e.target.value })}
                  placeholder="Ex: Advogado Sênior"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Descrição
                </label>
                <Input
                  value={newRole.descricao}
                  onChange={(e) => setNewRole({ ...newRole, descricao: e.target.value })}
                  placeholder="Descrição da role (opcional)"
                />
              </div>
              <Button onClick={handleCreate}>
                <Plus className="h-4 w-4 mr-2" />
                Criar Role
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Lista de Roles</CardTitle>
        </CardHeader>
        <CardContent>
          {roles.length === 0 ? (
            <p className="text-gray-500 text-center py-8">Nenhuma role cadastrada</p>
          ) : (
            <div className="space-y-2">
              {roles.map((role) => (
                <div
                  key={role.id}
                  className="flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50"
                >
                  {editingId === role.id ? (
                    <div className="flex-1 space-y-2">
                      <Input
                        value={editRole.nome}
                        onChange={(e) => setEditRole({ ...editRole, nome: e.target.value })}
                        className="mb-2"
                      />
                      <Input
                        value={editRole.descricao}
                        onChange={(e) => setEditRole({ ...editRole, descricao: e.target.value })}
                        placeholder="Descrição (opcional)"
                      />
                      <div className="flex gap-2 mt-2">
                        <Button
                          size="sm"
                          onClick={() => handleSaveEdit(role.id)}
                        >
                          Salvar
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setEditingId(null)
                            setEditRole({ nome: '', descricao: '' })
                          }}
                        >
                          Cancelar
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex-1">
                        <h3 className="font-medium text-gray-900">{role.nome}</h3>
                        {role.descricao && (
                          <p className="text-sm text-gray-500">{role.descricao}</p>
                        )}
                      </div>
                      {canWrite && (
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleEdit(role)}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleDelete(role.id)}
                          >
                            <Trash2 className="h-4 w-4 text-red-600" />
                          </Button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
