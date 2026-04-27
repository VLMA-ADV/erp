'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { isPermissionSatisfied } from '@/lib/permissions/permission-keys'
import { fetchWithRetry } from '@/lib/utils/fetch-with-retry'

const CACHE_KEY_PREFIX = 'permissions_cache_'
const CACHE_TTL_MS = 30 * 60 * 1000 // 30 minutos em milissegundos

interface CacheData {
  permissions: string[]
  timestamp: number
  userId: string
}

/**
 * Hook para gerenciar permissões do usuário com cache localStorage
 * Cache é invalidado após 5 minutos ou quando a página é recarregada
 *
 * Nota: `permissions` inicia vazio para garantir que o primeiro render client
 * seja idêntico ao SSR (que nunca tem acesso a localStorage). O cache síncrono
 * anterior (`syncReadCachedPermissions`) quebrava isso e produzia React #418/#423
 * (hydration mismatch). O cache volta a ser carregado assim que o useEffect abaixo
 * roda — custa um micro-flash de "sem permissão" no primeiro frame.
 */
export function usePermissions() {
  const [permissions, setPermissions] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const isLoadingRef = useRef(false)

  // Função para obter chave de cache baseada no user_id
  const getCacheKey = useCallback(async (): Promise<string | null> => {
    try {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user?.id) return null
      return `${CACHE_KEY_PREFIX}${session.user.id}`
    } catch {
      return null
    }
  }, [])

  // Função para ler do cache
  const getCachedPermissions = useCallback(async (): Promise<CacheData | null> => {
    try {
      const cacheKey = await getCacheKey()
      if (!cacheKey) return null

      const cached = localStorage.getItem(cacheKey)
      if (!cached) return null

      const cacheData: CacheData = JSON.parse(cached)
      const now = Date.now()

      // Verificar se cache ainda é válido (não passou TTL)
      if (now - cacheData.timestamp < CACHE_TTL_MS) {
        return cacheData
      }

      // Cache expirado, remover
      localStorage.removeItem(cacheKey)
      return null
    } catch (error) {
      console.error('Error reading permissions cache:', error)
      return null
    }
  }, [getCacheKey])

  // Função para salvar no cache
  const setCachedPermissions = useCallback(async (permissions: string[]) => {
    try {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user?.id) return

      const cacheKey = `${CACHE_KEY_PREFIX}${session.user.id}`
      const existing = localStorage.getItem(cacheKey)
      if (existing) {
        const existingCache = JSON.parse(existing) as CacheData
        const samePermissions =
          JSON.stringify(existingCache.permissions || []) === JSON.stringify(permissions || [])
        if (samePermissions) {
          localStorage.setItem(
            cacheKey,
            JSON.stringify({
              ...existingCache,
              timestamp: Date.now(),
            } satisfies CacheData)
          )
          return
        }
      }

      const cacheData: CacheData = {
        permissions,
        timestamp: Date.now(),
        userId: session.user.id,
      }

      localStorage.setItem(cacheKey, JSON.stringify(cacheData))
    } catch (error) {
      console.error('Error saving permissions cache:', error)
    }
  }, [])

  // Função para invalidar cache
  const invalidateCache = useCallback(async () => {
    try {
      const cacheKey = await getCacheKey()
      if (cacheKey) {
        localStorage.removeItem(cacheKey)
      }
    } catch (error) {
      console.error('Error invalidating permissions cache:', error)
    }
  }, [getCacheKey])

  // Função para buscar permissões da API
  const fetchPermissions = useCallback(async (signal?: AbortSignal): Promise<string[]> => {
    try {
      const supabase = createClient()

      // Obter token atualizado
      const { data: { session }, error: sessionError } = await supabase.auth.getSession()

      if (sessionError || !session) {
        console.error('Session error:', sessionError)
        return []
      }

      if (signal?.aborted) return []

      // Garantir que o token está atualizado
      const { data: { user }, error: userError } = await supabase.auth.getUser()

      if (userError || !user) {
        console.error('User error:', userError)
        return []
      }

      if (signal?.aborted) return []

      // Obter token atualizado novamente após getUser
      const { data: { session: updatedSession } } = await supabase.auth.getSession()

      if (!updatedSession?.access_token) {
        console.error('No access token available')
        return []
      }

      const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-user-permissions`

      const response = await fetchWithRetry(url, {
        method: 'GET',
        signal,
        headers: {
          'Authorization': `Bearer ${updatedSession.access_token}`,
          'Content-Type': 'application/json',
        },
      })

      if (response.ok) {
        const data = await response.json()
        const permissionsList = data.permissions || []

        // Salvar no cache
        await setCachedPermissions(permissionsList)

        return permissionsList
      } else {
        const errorText = await response.text()
        let errorData
        try {
          errorData = JSON.parse(errorText)
        } catch {
          errorData = { error: errorText }
        }
        console.error('Error fetching permissions:', errorData)
        return []
      }
    } catch (error) {
      // Caller cancelou (unmount/dependency change): silenciar
      if (error instanceof DOMException && error.name === 'AbortError') return []
      console.error('Error fetching permissions:', error)
      return []
    }
  }, [setCachedPermissions])

  useEffect(() => {
    const ac = new AbortController()

    async function loadPermissions() {
      if (isLoadingRef.current) return
      isLoadingRef.current = true
      setLoading(true)

      try {
        // Tentar ler do cache primeiro
        const cached = await getCachedPermissions()
        if (ac.signal.aborted) return

        if (cached) {
          console.log('Using cached permissions')
          setPermissions(cached.permissions)
          setLoading(false)

          // Buscar atualizações em background (sem bloquear UI)
          fetchPermissions(ac.signal).then((freshPermissions) => {
            if (ac.signal.aborted) return
            // Só atualizar se as permissões mudaram
            if (JSON.stringify(freshPermissions) !== JSON.stringify(cached.permissions)) {
              setPermissions(freshPermissions)
            }
          }).catch((err) => {
            if (err instanceof DOMException && err.name === 'AbortError') return
            console.error(err)
          })
        } else {
          // Cache não disponível ou expirado, buscar da API
          console.log('Fetching permissions from API')
          const permissionsList = await fetchPermissions(ac.signal)
          if (ac.signal.aborted) return
          setPermissions(permissionsList)
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return
        console.error('Error loading permissions:', error)
        setPermissions([])
      } finally {
        if (!ac.signal.aborted) setLoading(false)
        isLoadingRef.current = false
      }
    }

    loadPermissions()

    // Listener para invalidar cache em eventos específicos
    const handleStorageChange = (e: StorageEvent) => {
      if (!e.key?.startsWith(CACHE_KEY_PREFIX)) return
      if (!e.newValue) {
        void loadPermissions()
        return
      }

      try {
        const cacheData = JSON.parse(e.newValue) as CacheData
        if (!Array.isArray(cacheData.permissions)) {
          void loadPermissions()
          return
        }
        setPermissions(cacheData.permissions)
      } catch {
        void loadPermissions()
      }
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        // Página voltou a ficar visível, verificar se cache expirou
        getCachedPermissions().then((cached) => {
          if (ac.signal.aborted) return
          if (!cached) {
            // Cache expirado, recarregar
            loadPermissions()
          }
        })
      }
    }

    window.addEventListener('storage', handleStorageChange)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      ac.abort()
      window.removeEventListener('storage', handleStorageChange)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [getCachedPermissions, fetchPermissions])

  const hasPermission = useCallback((permission: string) => {
    return isPermissionSatisfied(permissions, permission)
  }, [permissions])

  // Expor função para invalidar cache manualmente
  return { 
    permissions, 
    loading, 
    hasPermission,
    invalidateCache 
  }
}
