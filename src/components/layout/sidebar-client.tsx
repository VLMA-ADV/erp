'use client'

import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { usePermissionsContext } from '@/lib/contexts/permissions-context'
import SidebarItem from './sidebar-item'
import SidebarMenuPessoas from './sidebar-menu-pessoas'
import SidebarMenuConfiguracao from './sidebar-menu-configuracao'
import SidebarMenuFaturamento from './sidebar-menu-faturamento'
import { Button } from '@/components/ui/button'
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader } from '@/components/ui/sidebar'

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
    label: 'CRM',
    href: '/crm',
    permission: 'crm.pipeline.read',
  },
  {
    label: 'Solicitações de Contrato',
    href: '/solicitacoes-contrato',
    permission: 'contracts.solicitacoes.read',
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
    label: 'PDI',
    href: '/avaliacoes-pdi',
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
      <Sidebar>
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded mb-4"></div>
          <div className="space-y-2">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-10 bg-gray-200 rounded"></div>
            ))}
          </div>
        </div>
      </Sidebar>
    )
  }

  // Se não houver permissões mas não estiver carregando, mostrar todos os itens (fallback temporário)
  const showAllItems = !loading && permissions.length === 0
  
  // Criar uma função hasPermission que sempre retorna true se showAllItems
  const checkPermission = (permission: string) => {
    if (showAllItems) {
      return true
    }
    return hasPermission(permission)
  }

  return (
    <Sidebar>
      <SidebarHeader>
        <h1 className="text-xl font-bold text-gray-900">ERP-VLMA</h1>
        <p className="text-sm text-gray-500">Versão 1.0.0</p>
      </SidebarHeader>
      <SidebarContent>
        {/* Menu Configuração (Expansível) */}
        <SidebarMenuConfiguracao pathname={pathname} hasPermission={checkPermission} />

        {/* Menu Pessoas (Expansível) */}
        <SidebarMenuPessoas pathname={pathname} hasPermission={checkPermission} />

        {/* Outros itens do menu (ordem: Dashboard, CRM, Solicitações, Contratos, Timesheet, Despesas) */}
        {['/home', '/crm', '/solicitacoes-contrato', '/contratos', '/timesheet', '/despesas'].map((href) => {
          const item = menuItems.find((m) => m.href === href)
          if (!item || !checkPermission(item.permission)) return null
          return (
            <SidebarItem
              key={item.href}
              href={item.href}
              label={item.label}
              active={pathname === item.href}
            />
          )
        })}

        {/* Menu Faturamento (Expansível) */}
        <SidebarMenuFaturamento pathname={pathname} hasPermission={checkPermission} />

        {/* PDI e Relatórios */}
        {['/avaliacoes-pdi', '/relatorios'].map((href) => {
          const item = menuItems.find((m) => m.href === href)
          if (!item || !checkPermission(item.permission)) return null
          return (
            <SidebarItem
              key={item.href}
              href={item.href}
              label={item.label}
              active={pathname === item.href}
            />
          )
        })}
      </SidebarContent>
      
      {/* Botão de Logout */}
      <SidebarFooter>
        <Button
          variant="outline"
          className="w-full"
          onClick={handleLogout}
        >
          Sair
        </Button>
      </SidebarFooter>
    </Sidebar>
  )
}
