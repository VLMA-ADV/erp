'use client'

import { createContext, useCallback, useContext, useMemo, useState } from 'react'

type ToastType = 'success' | 'error' | 'info'

type ToastItem = {
  id: string
  message: string
  type: ToastType
}

type SonnerContextType = {
  toast: (message: string, type?: ToastType) => void
}

const SonnerContext = createContext<SonnerContextType | null>(null)

export function SonnerProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])

  const toast = useCallback((message: string, type: ToastType = 'info') => {
    const id = crypto.randomUUID()
    setItems((prev) => [...prev, { id, message, type }])
    setTimeout(() => setItems((prev) => prev.filter((i) => i.id !== id)), 3000)
  }, [])

  const value = useMemo(() => ({ toast }), [toast])

  return (
    <SonnerContext.Provider value={value}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 space-y-2">
        {items.map((item) => (
          <div
            key={item.id}
            className={`min-w-56 rounded-md border px-3 py-2 text-sm shadow ${
              item.type === 'success'
                ? 'border-green-200 bg-green-50 text-green-800'
                : item.type === 'error'
                ? 'border-red-200 bg-red-50 text-red-800'
                : 'border-gray-200 bg-white text-gray-800'
            }`}
          >
            {item.message}
          </div>
        ))}
      </div>
    </SonnerContext.Provider>
  )
}

export function useSonner() {
  const ctx = useContext(SonnerContext)
  if (!ctx) throw new Error('useSonner must be used within SonnerProvider')
  return ctx
}
