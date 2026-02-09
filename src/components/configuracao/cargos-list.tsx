'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import CargosTable from './cargos-table'
import CargosSearch from './cargos-search'
import CargoModal from './cargo-modal'
import { Button } from '@/components/ui/button'
import { usePermissionsContext } from '@/lib/contexts/permissions-context'
import { Plus } from 'lucide-react'

interface Cargo {
  id: string
  nome: string
  codigo: string
  nivel?: number | null
  ativo: boolean
}

export default function CargosList() {
  const { hasPermission } = usePermissionsContext()
  const [cargos, setCargos] = useState<Cargo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editingCargo, setEditingCargo] = useState<Cargo | null>(null)

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
        let cargosList = data.data || []
        
        // Filtrar por busca
        if (search) {
          const searchLower = search.toLowerCase()
          cargosList = cargosList.filter((cargo: Cargo) =>
            cargo.nome.toLowerCase().includes(searchLower) ||
            cargo.codigo.toLowerCase().includes(searchLower)
          )
        }
        
        setCargos(cargosList)
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

  useEffect(() => {
    if (canRead) {
      fetchCargos()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const handleCreate = () => {
    setEditingCargo(null)
    setModalOpen(true)
  }

  const handleEdit = (cargo: Cargo) => {
    setEditingCargo(cargo)
    setModalOpen(true)
  }

  const handleModalSuccess = () => {
    setModalOpen(false)
    setEditingCargo(null)
    fetchCargos()
  }

  const handleModalError = (errorMessage: string) => {
    setError(errorMessage)
  }

  if (!canRead) {
    return (
      <div className="rounded-md bg-red-50 p-4">
        <p className="text-sm text-red-800">Você não tem permissão para visualizar cargos</p>
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
        <CargosSearch onSearch={setSearch} />
        {canWrite && (
          <Button onClick={handleCreate}>
            <Plus className="h-4 w-4 mr-2" />
            Novo Cargo
          </Button>
        )}
      </div>

      <CargosTable
        cargos={cargos}
        loading={loading}
        onEdit={handleEdit}
        onRefresh={fetchCargos}
      />

      {canWrite && (
        <CargoModal
          open={modalOpen}
          onOpenChange={setModalOpen}
          cargo={editingCargo}
          onSuccess={handleModalSuccess}
          onError={handleModalError}
        />
      )}
    </div>
  )
}
