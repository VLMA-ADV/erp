'use client'

import { useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { usePermissionsContext } from '@/lib/contexts/permissions-context'
import ServicosSearch from './servicos-search'
import ServicosTable from './servicos-table'
import ServicoModal from './servico-modal'

interface Servico {
  id: string
  nome: string
}

export default function ServicosList() {
  const { hasPermission } = usePermissionsContext()
  const [servicos, setServicos] = useState<Servico[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editingServico, setEditingServico] = useState<Servico | null>(null)

  const canWrite = hasPermission('config.servicos.write')
  const canRead = hasPermission('config.servicos.read')

  const fetchServicos = async () => {
    try {
      setLoading(true)
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return

      const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-servicos`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
      })

      if (!response.ok) {
        const err = await response.json()
        setError(err.error || 'Erro ao carregar serviços')
        return
      }

      const data = await response.json()
      let list = data.data || []
      if (search) {
        const term = search.toLowerCase()
        list = list.filter((item: Servico) => item.nome.toLowerCase().includes(term))
      }
      setServicos(list)
    } catch (err) {
      console.error(err)
      setError('Erro ao carregar serviços')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (canRead) fetchServicos()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canRead, search])

  if (!canRead) {
    return (
      <div className="rounded-md bg-red-50 p-4">
        <p className="text-sm text-red-800">Você não tem permissão para visualizar serviços</p>
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
        <ServicosSearch onSearch={setSearch} />
        {canWrite && (
          <Button onClick={() => { setEditingServico(null); setModalOpen(true) }}>
            <Plus className="h-4 w-4 mr-2" />
            Novo Serviço
          </Button>
        )}
      </div>

      <ServicosTable servicos={servicos} loading={loading} onEdit={(item) => { setEditingServico(item); setModalOpen(true) }} />

      {canWrite && (
        <ServicoModal
          open={modalOpen}
          onOpenChange={setModalOpen}
          servico={editingServico}
          onSuccess={() => { setModalOpen(false); setEditingServico(null); fetchServicos() }}
          onError={setError}
        />
      )}
    </div>
  )
}
