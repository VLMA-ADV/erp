'use client'

import { ToastContainer } from './toast'
import { useToast } from './use-toast'

export function ToastContainerClient() {
  const { toasts, removeToast } = useToast()

  return <ToastContainer toasts={toasts} onClose={removeToast} />
}
