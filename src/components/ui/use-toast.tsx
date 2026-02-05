'use client'

import * as React from 'react'
import { ToastProps } from './toast'

interface ToastContextType {
  toasts: ToastProps[]
  showToast: (message: string, type?: ToastProps['type'], duration?: number) => void
  removeToast: (id: string) => void
}

const ToastContext = React.createContext<ToastContextType | undefined>(undefined)

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastProps[]>([])

  const showToast = React.useCallback(
    (message: string, type: ToastProps['type'] = 'info', duration = 5000) => {
      const id = Math.random().toString(36).substring(7)
      const newToast: ToastProps = {
        id,
        message,
        type,
        duration,
        onClose: removeToast,
      }

      setToasts((prev) => [...prev, newToast])
    },
    []
  )

  const removeToast = React.useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id))
  }, [])

  return (
    <ToastContext.Provider value={{ toasts, showToast, removeToast }}>
      {children}
    </ToastContext.Provider>
  )
}

export function useToast() {
  const context = React.useContext(ToastContext)
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider')
  }
  return context
}
