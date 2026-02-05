'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { usePermissionsContext } from '@/lib/contexts/permissions-context'
import { Plus, Edit, Trash2 } from 'lucide-react'

interface Cargo {
  id: string
  nome: string
  descricao: string | null
  ativo: boolean
  created_at: string
}

export default function CargosList() {
  const { hasPermission } = usePermissionsContext()
  const [cargos, setCargos] = useState<Cargo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [newCargo, setNewCargo] = useState({ nome: '', descricao: '' })
  const [editCargo, setEditCargo] = useState({ nome: '', descricao: '' })

  const canWrite = hasPermission('config.cargos.write') || hasPermission('config.cargos.*')
  const canRead = hasPermission('config.cargos.read') || hasPermission('config.cargos.*')

  useEffect(() => {
    if (canRead) {
      fetchCargos()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canRead])

  const fetchCargos = async () => {
    try {
      setLoading(true)
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()

      if (!session) return

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-cargos`,
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
        setCargos(data.data || [])
      } else {
        const errorData = await response.json()
        setError(errorData.error || 'Erro ao carregar cargos')
      }
    } catch (err) {
      console.error('Error fetching cargos:', err)
      setError('Erro ao carregar cargos')
    } finally {
      setLoading(false)
    }
  }

  const handleCreate = async () => {
    if (!newCargo.nome.trim()) {
      setError('Nome do cargo é obrigatório')
      return
    }

    try {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()

      if (!session) return

      // TODO: Criar Edge Function para criar cargo
      // Por enquanto, apenas mostrar mensagem
      alert('Funcionalidade de criar cargo será implementada em breve')
      
      // Limpar formulário
      setNewCargo({ nome: '', descricao: '' })
    } catch (err) {
      console.error('Error creating cargo:', err)
      setError('Erro ao criar cargo')
    }
  }

  const handleEdit = (cargo: Cargo) => {
    setEditingId(cargo.id)
    setEditCargo({ nome: cargo.nome, descricao: cargo.descricao || '' })
  }

  const handleSaveEdit = async (id: string) => {
    if (!editCargo.nome.trim()) {
      setError('Nome do cargo é obrigatório')
      return
    }

    try {
      // TODO: Criar Edge Function para atualizar cargo
      alert('Funcionalidade de editar cargo será implementada em breve')
      setEditingId(null)
      setEditCargo({ nome: '', descricao: '' })
      fetchCargos()
    } catch (err) {
      console.error('Error updating cargo:', err)
      setError('Erro ao atualizar cargo')
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Tem certeza que deseja excluir este cargo?')) {
      return
    }

    try {
      // TODO: Criar Edge Function para deletar cargo
      alert('Funcionalidade de deletar cargo será implementada em breve')
      fetchCargos()
    } catch (err) {
      console.error('Error deleting cargo:', err)
      setError('Erro ao excluir cargo')
    }
  }

  if (!canRead) {
    return (
      <div className="rounded-md bg-red-50 p-4">
        <p className="text-sm text-red-800">Você não tem permissão para visualizar cargos</p>
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
            <CardTitle>Novo Cargo</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Nome *
                </label>
                <Input
                  value={newCargo.nome}
                  onChange={(e) => setNewCargo({ ...newCargo, nome: e.target.value })}
                  placeholder="Ex: Advogado Sênior"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Descrição
                </label>
                <Input
                  value={newCargo.descricao}
                  onChange={(e) => setNewCargo({ ...newCargo, descricao: e.target.value })}
                  placeholder="Descrição do cargo (opcional)"
                />
              </div>
              <Button onClick={handleCreate}>
                <Plus className="h-4 w-4 mr-2" />
                Criar Cargo
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Lista de Cargos</CardTitle>
        </CardHeader>
        <CardContent>
          {cargos.length === 0 ? (
            <p className="text-gray-500 text-center py-8">Nenhum cargo cadastrado</p>
          ) : (
            <div className="space-y-2">
              {cargos.map((cargo) => (
                <div
                  key={cargo.id}
                  className="flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50"
                >
                  {editingId === cargo.id ? (
                    <div className="flex-1 space-y-2">
                      <Input
                        value={editCargo.nome}
                        onChange={(e) => setEditCargo({ ...editCargo, nome: e.target.value })}
                        className="mb-2"
                      />
                      <Input
                        value={editCargo.descricao}
                        onChange={(e) => setEditCargo({ ...editCargo, descricao: e.target.value })}
                        placeholder="Descrição (opcional)"
                      />
                      <div className="flex gap-2 mt-2">
                        <Button
                          size="sm"
                          onClick={() => handleSaveEdit(cargo.id)}
                        >
                          Salvar
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setEditingId(null)
                            setEditCargo({ nome: '', descricao: '' })
                          }}
                        >
                          Cancelar
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex-1">
                        <h3 className="font-medium text-gray-900">{cargo.nome}</h3>
                        {cargo.descricao && (
                          <p className="text-sm text-gray-500">{cargo.descricao}</p>
                        )}
                      </div>
                      {canWrite && (
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleEdit(cargo)}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleDelete(cargo.id)}
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
