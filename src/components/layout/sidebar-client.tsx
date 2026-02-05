'use client'

import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { usePermissionsContext } from '@/lib/contexts/permissions-context'
import SidebarItem from './sidebar-item'
import SidebarMenuPessoas from './sidebar-menu-pessoas'
import SidebarMenuConfiguracao from './sidebar-menu-configuracao'
import { Button } from '@/components/ui/button'

const menuItems = [
  {
    label: 'Dashboard',
    href: '/home',
    permission: 'dashboard.view',
  },
  {
    label: 'Contratos',
    href: '/contratos',
    permission: 'contracts.contratos.read',
  },
  {
    label: 'Timesheet',
    href: '/timesheet',
    permission: 'operations.timesheet.read',
  },
  {
    label: 'Despesas',
    href: '/despesas',
    permission: 'operations.despesas.read',
  },
  {
    label: 'Financeiro',
    href: '/financeiro',
    permission: 'finance.faturamento.read',
  },
  {
    label: 'PDI',
    href: '/pdi',
    permission: 'people.pdi.read',
  },
  {
    label: 'Relatórios',
    href: '/relatorios',
    permission: 'reports.view',
  },
]

export default function SidebarClient() {
  const pathname = usePathname()
  const router = useRouter()
  const { hasPermission, loading, permissions } = usePermissionsContext()

  const handleLogout = async () => {
    try {
      const supabase = createClient()
      await supabase.auth.signOut()
      router.push('/login')
      router.refresh()
    } catch (error) {
      console.error('Error logging out:', error)
    }
  }

  if (loading) {
    return (
      <aside className="w-64 border-r bg-gray-50 p-4 flex flex-col h-full">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded mb-4"></div>
          <div className="space-y-2">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-10 bg-gray-200 rounded"></div>
            ))}
          </div>
        </div>
      </aside>
    )
  }

  // Debug: mostrar permissões no console
  console.log('SidebarClient - Current permissions:', permissions)
  console.log('SidebarClient - Has dashboard.view:', hasPermission('dashboard.view'))
  console.log('SidebarClient - Has people.colaboradores.read:', hasPermission('people.colaboradores.read'))
  console.log('SidebarClient - Loading:', loading)

  // Se não houver permissões mas não estiver carregando, mostrar todos os itens (fallback temporário)
  const showAllItems = !loading && permissions.length === 0
  
  // Criar uma função hasPermission que sempre retorna true se showAllItems
  const checkPermission = (permission: string) => {
    if (showAllItems) {
      console.log(`checkPermission(${permission}): true (showAllItems)`)
      return true
    }
    const result = hasPermission(permission)
    console.log(`checkPermission(${permission}): ${result}`)
    return result
  }

  return (
    <aside className="w-64 border-r bg-gray-50 p-4 flex flex-col h-full">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">ERP-VLMA</h1>
      </div>
      <nav className="space-y-1 flex-1">
        {/* Menu Pessoas (Expansível) */}
        <SidebarMenuPessoas pathname={pathname} hasPermission={checkPermission} />

        {/* Menu Configuração (Expansível) */}
        <SidebarMenuConfiguracao pathname={pathname} hasPermission={checkPermission} />

        {/* Outros itens do menu */}
        {menuItems.map((item) => {
          // Se showAllItems, mostrar todos; caso contrário, verificar permissão
          if (!checkPermission(item.permission)) {
            return null
          }

          return (
            <SidebarItem
              key={item.href}
              href={item.href}
              label={item.label}
              active={pathname === item.href}
            />
          )
        })}
      </nav>
      
      {/* Botão de Logout */}
      <div className="mt-auto pt-4 border-t">
        <Button
          variant="outline"
          className="w-full"
          onClick={handleLogout}
        >
          Sair
        </Button>
      </div>
    </aside>
  )
}
