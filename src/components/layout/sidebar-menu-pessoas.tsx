'use client'

import { useState } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils/cn'

interface SidebarMenuPessoasProps {
  pathname: string
  hasPermission: (permission: string) => boolean
}

const pessoasMenuItems = [
  {
    label: 'Colaboradores',
    href: '/pessoas/colaboradores',
    permission: 'people.colaboradores.read',
  },
  {
    label: 'Parceiros',
    href: '/pessoas/parceiros',
    permission: 'people.parceiros.read',
  },
  {
    label: 'Prestadores de Serviço',
    href: '/pessoas/prestadores',
    permission: 'people.prestadores.read',
  },
  {
    label: 'Clientes',
    href: '/pessoas/clientes',
    permission: 'crm.clientes.read',
  },
]

export default function SidebarMenuPessoas({
  pathname,
  hasPermission,
}: SidebarMenuPessoasProps) {
  const [isOpen, setIsOpen] = useState(
    pathname.startsWith('/pessoas') || pathname.startsWith('/crm/clientes')
  )

  // Verificar se há pelo menos um item visível
  const hasVisibleItems = pessoasMenuItems.some((item) =>
    hasPermission(item.permission)
  )

  // Se não houver itens visíveis, não renderizar o menu
  if (!hasVisibleItems) {
    return null
  }

  const isActive = pathname.startsWith('/pessoas') || pathname.startsWith('/crm/clientes')

  return (
    <div>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'flex w-full items-center justify-between px-4 py-2 text-sm font-medium rounded-md transition-colors',
          isActive
            ? 'bg-primary text-primary-foreground'
            : 'text-gray-700 hover:bg-gray-100'
        )}
      >
        <span>Pessoas</span>
        <svg
          className={cn(
            'h-4 w-4 transition-transform',
            isOpen && 'rotate-180'
          )}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>
      {isOpen && (
        <div className="ml-4 mt-1 space-y-1">
          {pessoasMenuItems.map((item) => {
            // Só mostrar item se o usuário tiver permissão
            if (!hasPermission(item.permission)) {
              return null
            }

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center px-4 py-2 text-sm rounded-md transition-colors',
                  pathname === item.href
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'text-gray-600 hover:bg-gray-100'
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
