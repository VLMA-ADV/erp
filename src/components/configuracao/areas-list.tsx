'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { usePermissionsContext } from '@/lib/contexts/permissions-context'
import { Plus, Edit, Trash2 } from 'lucide-react'

interface Area {
  id: string
  nome: string
  descricao: string | null
  ativo: boolean
  created_at: string
}

export default function AreasList() {
  const { hasPermission } = usePermissionsContext()
  const [areas, setAreas] = useState<Area[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [newArea, setNewArea] = useState({ nome: '', descricao: '' })
  const [editArea, setEditArea] = useState({ nome: '', descricao: '' })

  const canWrite = hasPermission('config.areas.write') || hasPermission('config.areas.*')
  const canRead = hasPermission('config.areas.read') || hasPermission('config.areas.*')

  useEffect(() => {
    if (canRead) {
      fetchAreas()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canRead])

  const fetchAreas = async () => {
    try {
      setLoading(true)
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()

      if (!session) return

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-areas`,
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
        setAreas(data.data || [])
      } else {
        const errorData = await response.json()
        setError(errorData.error || 'Erro ao carregar áreas')
      }
    } catch (err) {
      console.error('Error fetching areas:', err)
      setError('Erro ao carregar áreas')
    } finally {
      setLoading(false)
    }
  }

  const handleCreate = async () => {
    if (!newArea.nome.trim()) {
      setError('Nome da área é obrigatório')
      return
    }

    try {
      // TODO: Criar Edge Function para criar área
      alert('Funcionalidade de criar área será implementada em breve')
      setNewArea({ nome: '', descricao: '' })
    } catch (err) {
      console.error('Error creating area:', err)
      setError('Erro ao criar área')
    }
  }

  const handleEdit = (area: Area) => {
    setEditingId(area.id)
    setEditArea({ nome: area.nome, descricao: area.descricao || '' })
  }

  const handleSaveEdit = async (id: string) => {
    if (!editArea.nome.trim()) {
      setError('Nome da área é obrigatório')
      return
    }

    try {
      // TODO: Criar Edge Function para atualizar área
      alert('Funcionalidade de editar área será implementada em breve')
      setEditingId(null)
      setEditArea({ nome: '', descricao: '' })
      fetchAreas()
    } catch (err) {
      console.error('Error updating area:', err)
      setError('Erro ao atualizar área')
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Tem certeza que deseja excluir esta área?')) {
      return
    }

    try {
      // TODO: Criar Edge Function para deletar área
      alert('Funcionalidade de deletar área será implementada em breve')
      fetchAreas()
    } catch (err) {
      console.error('Error deleting area:', err)
      setError('Erro ao excluir área')
    }
  }

  if (!canRead) {
    return (
      <div className="rounded-md bg-red-50 p-4">
        <p className="text-sm text-red-800">Você não tem permissão para visualizar áreas</p>
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
            <CardTitle>Nova Área</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Nome *
                </label>
                <Input
                  value={newArea.nome}
                  onChange={(e) => setNewArea({ ...newArea, nome: e.target.value })}
                  placeholder="Ex: Direito Trabalhista"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Descrição
                </label>
                <Input
                  value={newArea.descricao}
                  onChange={(e) => setNewArea({ ...newArea, descricao: e.target.value })}
                  placeholder="Descrição da área (opcional)"
                />
              </div>
              <Button onClick={handleCreate}>
                <Plus className="h-4 w-4 mr-2" />
                Criar Área
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Lista de Áreas</CardTitle>
        </CardHeader>
        <CardContent>
          {areas.length === 0 ? (
            <p className="text-gray-500 text-center py-8">Nenhuma área cadastrada</p>
          ) : (
            <div className="space-y-2">
              {areas.map((area) => (
                <div
                  key={area.id}
                  className="flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50"
                >
                  {editingId === area.id ? (
                    <div className="flex-1 space-y-2">
                      <Input
                        value={editArea.nome}
                        onChange={(e) => setEditArea({ ...editArea, nome: e.target.value })}
                        className="mb-2"
                      />
                      <Input
                        value={editArea.descricao}
                        onChange={(e) => setEditArea({ ...editArea, descricao: e.target.value })}
                        placeholder="Descrição (opcional)"
                      />
                      <div className="flex gap-2 mt-2">
                        <Button
                          size="sm"
                          onClick={() => handleSaveEdit(area.id)}
                        >
                          Salvar
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setEditingId(null)
                            setEditArea({ nome: '', descricao: '' })
                          }}
                        >
                          Cancelar
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex-1">
                        <h3 className="font-medium text-gray-900">{area.nome}</h3>
                        {area.descricao && (
                          <p className="text-sm text-gray-500">{area.descricao}</p>
                        )}
                      </div>
                      {canWrite && (
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleEdit(area)}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleDelete(area.id)}
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
