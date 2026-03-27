'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import ColaboradoresTable from './colaboradores-table'
import ColaboradoresSearch from './colaboradores-search'
import { NativeSelect } from '@/components/ui/native-select'
import { Label } from '@/components/ui/label'
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

interface Area {
  id: string
  nome: string
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
  const [areaId, setAreaId] = useState('')
  const [areas, setAreas] = useState<Area[]>([])
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 0,
  })

  const fetchAreas = async () => {
    try {
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
        setAreas((data.data || []).filter((a: Area) => a.nome))
      }
    } catch (error) {
      console.error('Error fetching areas:', error)
    }
  }

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
      if (areaId) {
        params.append('area_id', areaId)
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
    fetchAreas()
  }, [])

  useEffect(() => {
    fetchColaboradores()
  }, [pagination.page, search, areaId])

  const handleSearch = useCallback((value: string) => {
    setSearch(value)
    setPagination((prev) => ({ ...prev, page: 1 }))
  }, [])

  const handleAreaFilter = useCallback((value: string) => {
    setAreaId(value)
    setPagination((prev) => ({ ...prev, page: 1 }))
  }, [])

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <ColaboradoresSearch onSearch={handleSearch} />
        <div className="flex items-center gap-2">
          <Label htmlFor="area-filter" className="whitespace-nowrap text-sm">Centro de custo</Label>
          <NativeSelect
            id="area-filter"
            value={areaId}
            onChange={(e) => handleAreaFilter(e.target.value)}
            className="w-48"
          >
            <option value="">Todos</option>
            {areas.map((area) => (
              <option key={area.id} value={area.id}>{area.nome}</option>
            ))}
          </NativeSelect>
        </div>
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
