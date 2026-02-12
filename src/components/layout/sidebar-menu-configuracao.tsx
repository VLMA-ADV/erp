'use client'

import { useState } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils/cn'

interface SidebarMenuConfiguracaoProps {
  pathname: string
  hasPermission: (permission: string) => boolean
}

const configuracaoMenuItems = [
  {
    label: 'Cargos',
    href: '/configuracao/cargos',
    permission: 'config.cargos.read',
  },
  {
    label: 'Centro de custo',
    href: '/configuracao/areas',
    permission: 'config.centro_custo.read',
  },
  {
    label: 'Serviços',
    href: '/configuracao/servicos',
    permission: 'config.servicos.read',
  },
  {
    label: 'Produtos',
    href: '/configuracao/servicos-produtos',
    permission: 'config.produtos.read',
  },
  {
    label: 'Segmentos Econômicos',
    href: '/configuracao/segmentos-economicos',
    permission: 'config.segmentos.read',
  },
  {
    label: 'Grupos Econômicos',
    href: '/configuracao/grupos-economicos',
    permission: 'config.grupos.read',
  },
  {
    label: 'Roles',
    href: '/configuracao/roles',
    permission: 'config.roles.read',
  },
  {
    label: 'Permissões',
    href: '/configuracao/permissoes',
    permission: 'config.permissions.read',
  },
]

export default function SidebarMenuConfiguracao({
  pathname,
  hasPermission,
}: SidebarMenuConfiguracaoProps) {
  const [isOpen, setIsOpen] = useState(
    pathname.startsWith('/configuracao')
  )

  // Verificar se há pelo menos um item visível
  // Para usuários socio/administrativo, mostrar todos os itens
  const hasVisibleItems = configuracaoMenuItems.some((item) =>
    hasPermission(item.permission) || 
    hasPermission('config.*') ||
    hasPermission('*')
  )

  if (!hasVisibleItems) {
    return null
  }

  const isActive = pathname.startsWith('/configuracao')

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
        <span>Configuração</span>
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
          {configuracaoMenuItems.map((item) => {
            // Mostrar item se tiver permissão específica, permissão genérica de config, ou acesso total
            if (!hasPermission(item.permission) && 
                !hasPermission('config.*') && 
                !hasPermission('*')) {
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
