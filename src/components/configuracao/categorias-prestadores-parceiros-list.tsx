'use client'

import { useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { usePermissionsContext } from '@/lib/contexts/permissions-context'
import CategoriasPrestadoresParceirosSearch from './categorias-prestadores-parceiros-search'
import CategoriasPrestadoresParceirosTable, { type CategoriaPrestadorParceiroItem } from './categorias-prestadores-parceiros-table'
import CategoriaPrestadorParceiroModal from './categoria-prestador-parceiro-modal'

export default function CategoriasPrestadoresParceirosList() {
  const { hasPermission } = usePermissionsContext()
  const [items, setItems] = useState<CategoriaPrestadorParceiroItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<CategoriaPrestadorParceiroItem | null>(null)

  const canWrite = hasPermission('config.categorias_prestadores_parceiros.write') || hasPermission('config.categorias_prestadores_parceiros.*')
  const canRead = hasPermission('config.categorias_prestadores_parceiros.read') || hasPermission('config.categorias_prestadores_parceiros.*')

  const fetchItems = async () => {
    try {
      setLoading(true)
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return

      const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-categorias-prestadores-parceiros`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
      })

      if (!response.ok) {
        const err = await response.json()
        setError(err.error || 'Erro ao carregar categorias')
        return
      }

      const data = await response.json()
      let list = data.data || []
      if (search) {
        const term = search.toLowerCase()
        list = list.filter((item: CategoriaPrestadorParceiroItem) => item.nome.toLowerCase().includes(term))
      }
      setItems(list)
    } catch (err) {
      console.error(err)
      setError('Erro ao carregar categorias')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (canRead) fetchItems()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canRead, search])

  if (!canRead) {
    return (
      <div className="rounded-md bg-red-50 p-4">
        <p className="text-sm text-red-800">Você não tem permissão para visualizar categorias de prestadores/parceiros</p>
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
        <CategoriasPrestadoresParceirosSearch onSearch={setSearch} />
        {canWrite && (
          <Button onClick={() => { setEditing(null); setModalOpen(true) }}>
            <Plus className="h-4 w-4 mr-2" />
            Nova categoria
          </Button>
        )}
      </div>

      <CategoriasPrestadoresParceirosTable items={items} loading={loading} onEdit={(item) => { setEditing(item); setModalOpen(true) }} />

      {canWrite && (
        <CategoriaPrestadorParceiroModal
          open={modalOpen}
          onOpenChange={setModalOpen}
          item={editing}
          onSuccess={() => { setModalOpen(false); setEditing(null); fetchItems() }}
          onError={setError}
        />
      )}
    </div>
  )
}
