'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

// Cache em memória durante a sessão
const cache: {
  cargos: any[] | null
  areas: any[] | null
  roles: any[] | null
  permissions: Record<string, Array<{ id: string; chave: string; descricao: string }>> | null
  timestamp: number | null
} = {
  cargos: null,
  areas: null,
  roles: null,
  permissions: null,
  timestamp: null,
}

const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutos

interface UseColaboradorFormDataReturn {
  cargos: any[]
  areas: any[]
  roles: any[]
  permissions: Record<string, Array<{ id: string; chave: string; descricao: string }>>
  loading: boolean
  error: string | null
}

/**
 * Hook compartilhado para buscar dados de formulário de colaborador
 * Cache em memória durante a sessão para evitar múltiplas chamadas
 */
export function useColaboradorFormData(): UseColaboradorFormDataReturn {
  const [cargos, setCargos] = useState<any[]>([])
  const [areas, setAreas] = useState<any[]>([])
  const [roles, setRoles] = useState<any[]>([])
  const [permissions, setPermissions] = useState<Record<string, Array<{ id: string; chave: string; descricao: string }>>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchData() {
      try {
        const supabase = createClient()
        const { data: { session } } = await supabase.auth.getSession()

        if (!session) {
          setError('No session found')
          setLoading(false)
          return
        }

        const headers = {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        }

        // Verificar se cache ainda é válido
        const now = Date.now()
        if (
          cache.cargos !== null &&
          cache.areas !== null &&
          cache.roles !== null &&
          cache.permissions !== null &&
          cache.timestamp !== null &&
          (now - cache.timestamp) < CACHE_TTL_MS
        ) {
          console.log('Using cached form data')
          setCargos(cache.cargos)
          setAreas(cache.areas)
          setRoles(cache.roles)
          setPermissions(cache.permissions)
          setLoading(false)
          return
        }

        console.log('Fetching form data from API')

        // Buscar todos os dados em paralelo
        const [cargosResponse, areasResponse, rolesResponse, permissionsResponse] = await Promise.all([
          fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-cargos`, { method: 'GET', headers }),
          fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-areas`, { method: 'GET', headers }),
          fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-roles`, { method: 'GET', headers }),
          fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-permissions`, { method: 'GET', headers }),
        ])

        // Processar respostas
        const cargosData = cargosResponse.ok ? await cargosResponse.json() : { data: [] }
        const areasData = areasResponse.ok ? await areasResponse.json() : { data: [] }
        const rolesData = rolesResponse.ok ? await rolesResponse.json() : { data: [] }
        const permissionsData = permissionsResponse.ok ? await permissionsResponse.json() : { data: {} }

        // Filtrar cargos e áreas por ativo=true para formulários
        const cargosList = (cargosData.data || []).filter((cargo: any) => cargo.ativo === true)
        const areasList = (areasData.data || []).filter((area: any) => area.ativo === true)
        const rolesList = rolesData.data || []
        const permissionsObj = permissionsData.data || {}

        // Atualizar cache
        cache.cargos = cargosList
        cache.areas = areasList
        cache.roles = rolesList
        cache.permissions = permissionsObj
        cache.timestamp = now

        // Atualizar estado
        setCargos(cargosList)
        setAreas(areasList)
        setRoles(rolesList)
        setPermissions(permissionsObj)
      } catch (err) {
        console.error('Error fetching form data:', err)
        setError('Erro ao carregar dados do formulário')
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [])

  return {
    cargos,
    areas,
    roles,
    permissions,
    loading,
    error,
  }
}
