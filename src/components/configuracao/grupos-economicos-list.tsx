'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import GruposEconomicosTable from './grupos-economicos-table'
import GruposEconomicosSearch from './grupos-economicos-search'
import GrupoEconomicoModal from './grupo-economico-modal'
import { Button } from '@/components/ui/button'
import { usePermissionsContext } from '@/lib/contexts/permissions-context'
import { Plus } from 'lucide-react'

interface GrupoEconomico {
  id: string
  nome: string
  ativo: boolean
  created_at: string
}

export default function GruposEconomicosList() {
  const { hasPermission } = usePermissionsContext()
  const [grupos, setGrupos] = useState<GrupoEconomico[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editingGrupo, setEditingGrupo] = useState<GrupoEconomico | null>(null)

  const canWrite = hasPermission('config.grupos.write') || hasPermission('config.grupos.*')
  const canRead = hasPermission('config.grupos.read') || hasPermission('config.grupos.*')

  useEffect(() => {
    if (canRead) {
      fetchGrupos()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canRead])

  const fetchGrupos = async () => {
    try {
      setLoading(true)
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()

      if (!session) return

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-grupos-economicos`,
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
        let gruposList = data.data || []
        
        // Filtrar por busca
        if (search) {
          const searchLower = search.toLowerCase()
          gruposList = gruposList.filter((grupo: GrupoEconomico) =>
            grupo.nome.toLowerCase().includes(searchLower)
          )
        }
        
        setGrupos(gruposList)
      } else {
        const errorData = await response.json()
        setError(errorData.error || 'Erro ao carregar grupos')
      }
    } catch (err) {
      console.error('Error fetching grupos:', err)
      setError('Erro ao carregar grupos')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (canRead) {
      fetchGrupos()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const handleCreate = () => {
    setEditingGrupo(null)
    setModalOpen(true)
  }

  const handleEdit = (grupo: GrupoEconomico) => {
    setEditingGrupo(grupo)
    setModalOpen(true)
  }

  const handleModalSuccess = () => {
    setModalOpen(false)
    setEditingGrupo(null)
    fetchGrupos()
  }

  const handleModalError = (errorMessage: string) => {
    setError(errorMessage)
  }

  if (!canRead) {
    return (
      <div className="rounded-md bg-red-50 p-4">
        <p className="text-sm text-red-800">Você não tem permissão para visualizar grupos econômicos</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-md bg-red-50 p-4">
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      <div className="flex items-center justify-between">
        <GruposEconomicosSearch onSearch={setSearch} />
        {canWrite && (
          <Button onClick={handleCreate}>
            <Plus className="h-4 w-4 mr-2" />
            Novo Grupo
          </Button>
        )}
      </div>

      <GruposEconomicosTable
        grupos={grupos}
        loading={loading}
        onEdit={handleEdit}
        onRefresh={fetchGrupos}
      />

      {canWrite && (
        <GrupoEconomicoModal
          open={modalOpen}
          onOpenChange={setModalOpen}
          grupo={editingGrupo}
          onSuccess={handleModalSuccess}
          onError={handleModalError}
        />
      )}
    </div>
  )
}
