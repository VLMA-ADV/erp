'use client'

import { useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { usePermissionsContext } from '@/lib/contexts/permissions-context'
import ServicosProdutosSearch from './servicos-produtos-search'
import ServicosProdutosTable from './servicos-produtos-table'
import ServicoProdutoModal from './servico-produto-modal'

interface ServicoProduto {
  id: string
  nome: string
}

export default function ServicosProdutosList() {
  const { hasPermission } = usePermissionsContext()
  const [servicosProdutos, setServicosProdutos] = useState<ServicoProduto[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editingServicoProduto, setEditingServicoProduto] = useState<ServicoProduto | null>(null)

  const canWrite = hasPermission('config.produtos.write')
  const canRead = hasPermission('config.produtos.read')

  const fetchServicosProdutos = async () => {
    try {
      setLoading(true)
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return

      const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-servicos-produtos`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
      })

      if (!response.ok) {
        const err = await response.json()
        setError(err.error || 'Erro ao carregar produtos')
        return
      }

      const data = await response.json()
      let list = data.data || []
      if (search) {
        const term = search.toLowerCase()
        list = list.filter((item: ServicoProduto) => item.nome.toLowerCase().includes(term))
      }
      setServicosProdutos(list)
    } catch (err) {
      console.error(err)
      setError('Erro ao carregar produtos')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (canRead) fetchServicosProdutos()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canRead, search])

  if (!canRead) {
    return (
      <div className="rounded-md bg-red-50 p-4">
        <p className="text-sm text-red-800">Você não tem permissão para visualizar produtos</p>
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
        <ServicosProdutosSearch onSearch={setSearch} />
        {canWrite && (
          <Button onClick={() => { setEditingServicoProduto(null); setModalOpen(true) }}>
            <Plus className="h-4 w-4 mr-2" />
            Novo Produto
          </Button>
        )}
      </div>

      <ServicosProdutosTable
        servicosProdutos={servicosProdutos}
        loading={loading}
        onEdit={(item) => { setEditingServicoProduto(item); setModalOpen(true) }}
        onRefresh={fetchServicosProdutos}
      />

      {canWrite && (
        <ServicoProdutoModal
          open={modalOpen}
          onOpenChange={setModalOpen}
          servicoProduto={editingServicoProduto}
          onSuccess={() => { setModalOpen(false); setEditingServicoProduto(null); fetchServicosProdutos() }}
          onError={setError}
        />
      )}
    </div>
  )
}
