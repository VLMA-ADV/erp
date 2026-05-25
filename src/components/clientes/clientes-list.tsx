'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { usePermissionsContext } from '@/lib/contexts/permissions-context'
import { Input } from '@/components/ui/input'
import ClientesTable from './clientes-table'
import ClientesCsvUpload from './clientes-csv-upload'

export interface ClienteListItem {
  id: string
  nome: string
  cliente_estrangeiro: boolean
  cnpj: string | null
  tipo: 'pessoa_fisica' | 'pessoa_juridica' | null
  grupo_economico_id: string | null
  ativo: boolean
  created_at: string
}

interface ListClientesPayload {
  data: ClienteListItem[]
  total: number
  limit: number
  offset: number
}

const PAGE_LIMIT = 5000

export default function ClientesList() {
  const { hasPermission } = usePermissionsContext()
  const canRead = hasPermission('crm.clientes.read')

  const [items, setItems] = useState<ClienteListItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const fetchItems = async (searchTerm: string) => {
    try {
      setLoading(true)
      setError(null)
      const supabase = createClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        setError('Sessão expirada')
        return
      }

      const { data, error: rpcErr } = await supabase.rpc('list_clientes_paginated', {
        p_user_id: user.id,
        p_limit: PAGE_LIMIT,
        p_offset: 0,
        p_search: searchTerm.trim() || null,
      })

      if (rpcErr) {
        setError(rpcErr.message || 'Erro ao carregar clientes')
        return
      }

      const payload = (data ?? { data: [], total: 0 }) as ListClientesPayload
      setItems(Array.isArray(payload.data) ? payload.data : [])
      setTotal(typeof payload.total === 'number' ? payload.total : 0)
    } catch (e) {
      console.error(e)
      setError('Erro ao carregar clientes')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!canRead) return
    void fetchItems(search)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canRead, search])

  if (!canRead) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4">
        <p className="text-sm text-destructive">
          Você não tem permissão para visualizar clientes
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nome ou CNPJ..."
          className="max-w-md"
        />
        <ClientesCsvUpload onComplete={() => void fetchItems(search)} />
      </div>

      {!loading && total > items.length ? (
        <p className="text-xs text-ink-mute">
          Mostrando {items.length} de {total} clientes. Refine a busca para encontrar mais.
        </p>
      ) : null}

      <ClientesTable items={items} loading={loading} onRefresh={() => void fetchItems(search)} />
    </div>
  )
}
