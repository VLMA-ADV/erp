'use client'

import { useState } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils/cn'

interface SidebarMenuFaturamentoProps {
  pathname: string
  hasPermission: (permission: string) => boolean
}

const faturamentoMenuItems = [
  {
    label: '1. Itens a faturar',
    href: '/financeiro/itens-a-faturar',
    permission: 'finance.faturamento.read',
  },
  {
    label: '2. Revisão de fatura',
    href: '/financeiro/revisao-de-fatura',
    permission: 'finance.faturamento.read',
  },
  {
    label: '3. Fluxo de faturamento',
    href: '/financeiro/fluxo-de-faturamento',
    permission: 'finance.faturamento.read',
  },
  {
    label: '4. Notas geradas',
    href: '/financeiro/notas-geradas',
    permission: 'finance.faturamento.read',
  },
]

export default function SidebarMenuFaturamento({
  pathname,
  hasPermission,
}: SidebarMenuFaturamentoProps) {
  const [isOpen, setIsOpen] = useState(pathname.startsWith('/financeiro'))
  const hasVisibleItems = faturamentoMenuItems.some((item) => hasPermission(item.permission))

  if (!hasVisibleItems) return null

  const isActive = pathname.startsWith('/financeiro')

  return (
    <div>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'flex w-full items-center justify-between px-4 py-2 text-sm font-medium rounded-md transition-colors',
          isActive ? 'bg-primary text-primary-foreground' : 'text-gray-700 hover:bg-gray-100',
        )}
      >
        <span>Faturamento</span>
        <svg
          className={cn('h-4 w-4 transition-transform', isOpen && 'rotate-180')}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="ml-4 mt-1 space-y-1">
          {faturamentoMenuItems.map((item) => {
            if (!hasPermission(item.permission)) return null

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center px-4 py-2 text-sm rounded-md transition-colors',
                  pathname === item.href ? 'bg-primary/10 text-primary font-medium' : 'text-gray-600 hover:bg-gray-100',
                )}
              >
                {item.label}
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
