'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { usePermissionsContext } from '@/lib/contexts/permissions-context'
import { Input } from '@/components/ui/input'
import PrestadoresTable from './prestadores-table'

export interface PrestadorListItem {
  id: string
  nome_prestador: string
  cpf_cnpj: string
  tipo_documento: 'cpf' | 'cnpj'
  servico_recorrente: boolean
  valor_recorrente: number | null
  ativo: boolean
  created_at: string
}

export default function PrestadoresList() {
  const { hasPermission } = usePermissionsContext()
  const canRead =
    hasPermission('people.prestadores.read') || hasPermission('people.prestadores.*')

  const [items, setItems] = useState<PrestadorListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const fetchItems = async () => {
    try {
      setLoading(true)
      setError(null)
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-prestadores`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
        }
      )

      const data = await response.json()
      if (!response.ok) {
        setError(data.error || 'Erro ao carregar prestadores')
        return
      }

      let list = (data.data || []) as PrestadorListItem[]
      if (search) {
        const s = search.toLowerCase()
        list = list.filter(
          (p) =>
            p.nome_prestador?.toLowerCase().includes(s) ||
            p.cpf_cnpj?.toLowerCase().includes(s)
        )
      }
      setItems(list)
    } catch (e) {
      console.error(e)
      setError('Erro ao carregar prestadores')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (canRead) fetchItems()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canRead])

  useEffect(() => {
    if (canRead) fetchItems()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  if (!canRead) {
    return (
      <div className="rounded-md bg-red-50 p-4">
        <p className="text-sm text-red-800">
          Você não tem permissão para visualizar prestadores
        </p>
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

      <div className="flex items-center justify-between gap-3">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nome ou CPF/CNPJ..."
          className="max-w-md"
        />
      </div>

      <PrestadoresTable items={items} loading={loading} onRefresh={fetchItems} />
    </div>
  )
}

