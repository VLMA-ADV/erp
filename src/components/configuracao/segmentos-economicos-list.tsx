'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import SegmentosEconomicosTable from './segmentos-economicos-table'
import SegmentosEconomicosSearch from './segmentos-economicos-search'
import SegmentoEconomicoModal from './segmento-economico-modal'
import { Button } from '@/components/ui/button'
import { usePermissionsContext } from '@/lib/contexts/permissions-context'
import { Plus } from 'lucide-react'

interface SegmentoEconomico {
  id: string
  nome: string
  ativo: boolean
}

export default function SegmentosEconomicosList() {
  const { hasPermission } = usePermissionsContext()
  const [segmentos, setSegmentos] = useState<SegmentoEconomico[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editingSegmento, setEditingSegmento] = useState<SegmentoEconomico | null>(null)

  const canWrite = hasPermission('config.segmentos.write')
  const canRead = hasPermission('config.segmentos.read')

  useEffect(() => {
    if (canRead) {
      fetchSegmentos()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canRead])

  const fetchSegmentos = async () => {
    try {
      setLoading(true)
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()

      if (!session) return

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-segmentos-economicos`,
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
        let segmentosList = data.data || []
        
        // Filtrar por busca
        if (search) {
          const searchLower = search.toLowerCase()
          segmentosList = segmentosList.filter((segmento: SegmentoEconomico) =>
            segmento.nome.toLowerCase().includes(searchLower)
          )
        }
        
        setSegmentos(segmentosList)
      } else {
        const errorData = await response.json()
        setError(errorData.error || 'Erro ao carregar segmentos')
      }
    } catch (err) {
      console.error('Error fetching segmentos:', err)
      setError('Erro ao carregar segmentos')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (canRead) {
      fetchSegmentos()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const handleCreate = () => {
    setEditingSegmento(null)
    setModalOpen(true)
  }

  const handleEdit = (segmento: SegmentoEconomico) => {
    setEditingSegmento(segmento)
    setModalOpen(true)
  }

  const handleModalSuccess = () => {
    setModalOpen(false)
    setEditingSegmento(null)
    fetchSegmentos()
  }

  const handleModalError = (errorMessage: string) => {
    setError(errorMessage)
  }

  if (!canRead) {
    return (
      <div className="rounded-md bg-red-50 p-4">
        <p className="text-sm text-red-800">Você não tem permissão para visualizar segmentos econômicos</p>
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
        <SegmentosEconomicosSearch onSearch={setSearch} />
        {canWrite && (
          <Button onClick={handleCreate}>
            <Plus className="h-4 w-4 mr-2" />
            Novo Segmento
          </Button>
        )}
      </div>

      <SegmentosEconomicosTable
        segmentos={segmentos}
        loading={loading}
        onEdit={handleEdit}
        onRefresh={fetchSegmentos}
      />

      {canWrite && (
        <SegmentoEconomicoModal
          open={modalOpen}
          onOpenChange={setModalOpen}
          segmento={editingSegmento}
          onSuccess={handleModalSuccess}
          onError={handleModalError}
        />
      )}
    </div>
  )
}
