'use client'

import Link from 'next/link'
import { cn } from '@/lib/utils/cn'

interface SidebarMenuContratosProps {
  pathname: string
  hasPermission: (permission: string) => boolean
}

export default function SidebarMenuContratos({
  pathname,
  hasPermission,
}: SidebarMenuContratosProps) {
  if (!hasPermission('contracts.contratos.read')) return null

  const isActive =
    pathname.startsWith('/contratos') || pathname.startsWith('/solicitacoes-contrato')

  return (
    <Link
      href="/contratos"
      className={cn(
        'flex w-full items-center px-4 py-2 text-sm font-medium rounded-md transition-colors',
        isActive ? 'bg-primary text-primary-foreground' : 'text-gray-700 hover:bg-gray-100',
      )}
    >
      Contratos
    </Link>
  )
}
