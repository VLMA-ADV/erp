'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import ColaboradoresTable from './colaboradores-table'
import ColaboradoresSearch from './colaboradores-search'
import { Button } from '@/components/ui/button'
import { usePermissionsContext } from '@/lib/contexts/permissions-context'

interface Colaborador {
  id: string
  nome: string
  email: string
  whatsapp: string | null
  ativo: boolean
  cargo: {
    nome: string
  } | null
}

interface Pagination {
  page: number
  limit: number
  total: number
  totalPages: number
}

export default function ColaboradoresList() {
  const router = useRouter()
  const { hasPermission } = usePermissionsContext()
  const [colaboradores, setColaboradores] = useState<Colaborador[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 0,
  })

  const fetchColaboradores = async () => {
    setLoading(true)
    try {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()

      if (!session) {
        router.push('/login')
        return
      }

      const params = new URLSearchParams({
        page: pagination.page.toString(),
        limit: pagination.limit.toString(),
      })

      if (search) {
        params.append('search', search)
      }

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/list-colaboradores?${params.toString()}`,
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
        setColaboradores(data.data || [])
        setPagination(data.pagination || pagination)
      } else {
        console.error('Error fetching colaboradores')
      }
    } catch (error) {
      console.error('Error:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchColaboradores()
  }, [pagination.page, search])

  const handleSearch = (value: string) => {
    setSearch(value)
    setPagination((prev) => ({ ...prev, page: 1 }))
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <ColaboradoresSearch onSearch={handleSearch} />
      </div>

      <ColaboradoresTable
        colaboradores={colaboradores}
        loading={loading}
        pagination={pagination}
        onPageChange={(page) => setPagination((prev) => ({ ...prev, page }))}
        onRefresh={fetchColaboradores}
      />
    </div>
  )
}
