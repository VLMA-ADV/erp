'use client'

import { useSonner } from '@/components/ui/sonner'

export function useToast() {
  const { toast } = useSonner()
  return {
    toast: (message: string) => toast(message, 'info'),
    success: (message: string) => toast(message, 'success'),
    error: (message: string) => toast(message, 'error'),
  }
}
