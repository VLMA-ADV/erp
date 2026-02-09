'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import AreasTable from './areas-table'
import AreasSearch from './areas-search'
import AreaModal from './area-modal'
import { Button } from '@/components/ui/button'
import { usePermissionsContext } from '@/lib/contexts/permissions-context'
import { Plus } from 'lucide-react'

interface Area {
  id: string
  nome: string
  codigo: string
  ativo: boolean
}

export default function AreasList() {
  const { hasPermission } = usePermissionsContext()
  const [areas, setAreas] = useState<Area[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editingArea, setEditingArea] = useState<Area | null>(null)

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
        let areasList = data.data || []
        
        // Filtrar por busca
        if (search) {
          const searchLower = search.toLowerCase()
          areasList = areasList.filter((area: Area) =>
            area.nome.toLowerCase().includes(searchLower) ||
            area.codigo.toLowerCase().includes(searchLower)
          )
        }
        
        setAreas(areasList)
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

  useEffect(() => {
    if (canRead) {
      fetchAreas()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const handleCreate = () => {
    setEditingArea(null)
    setModalOpen(true)
  }

  const handleEdit = (area: Area) => {
    setEditingArea(area)
    setModalOpen(true)
  }

  const handleModalSuccess = () => {
    setModalOpen(false)
    setEditingArea(null)
    fetchAreas()
  }

  const handleModalError = (errorMessage: string) => {
    setError(errorMessage)
  }

  if (!canRead) {
    return (
      <div className="rounded-md bg-red-50 p-4">
        <p className="text-sm text-red-800">Você não tem permissão para visualizar áreas</p>
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
        <AreasSearch onSearch={setSearch} />
        {canWrite && (
          <Button onClick={handleCreate}>
            <Plus className="h-4 w-4 mr-2" />
            Nova Área
          </Button>
        )}
      </div>

      <AreasTable
        areas={areas}
        loading={loading}
        onEdit={handleEdit}
        onRefresh={fetchAreas}
      />

      {canWrite && (
        <AreaModal
          open={modalOpen}
          onOpenChange={setModalOpen}
          area={editingArea}
          onSuccess={handleModalSuccess}
          onError={handleModalError}
        />
      )}
    </div>
  )
}
