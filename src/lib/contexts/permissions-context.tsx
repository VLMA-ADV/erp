'use client'

import React, { createContext, useContext, useMemo } from 'react'
import { usePermissions } from '@/lib/hooks/use-permissions'

interface PermissionsContextType {
  permissions: string[]
  categoria: string | null
  ehCoordenador: boolean
  isGestorModulos: boolean
  loading: boolean
  hasPermission: (permission: string) => boolean
  invalidateCache: () => Promise<void>
}

const PermissionsContext = createContext<PermissionsContextType | undefined>(undefined)

export function PermissionsProvider({ children }: { children: React.ReactNode }) {
  const { permissions, categoria, ehCoordenador, isGestorModulos, loading, hasPermission, invalidateCache } = usePermissions()

  // Memoizar o valor do contexto para evitar re-renders desnecessários
  const value = useMemo(
    () => ({
      permissions,
      categoria,
      ehCoordenador,
      isGestorModulos,
      loading,
      hasPermission,
      invalidateCache,
    }),
    [permissions, categoria, ehCoordenador, isGestorModulos, loading, hasPermission, invalidateCache]
  )

  return (
    <PermissionsContext.Provider value={value}>
      {children}
    </PermissionsContext.Provider>
  )
}

export function usePermissionsContext() {
  const context = useContext(PermissionsContext)
  if (context === undefined) {
    throw new Error('usePermissionsContext must be used within a PermissionsProvider')
  }
  return context
}
