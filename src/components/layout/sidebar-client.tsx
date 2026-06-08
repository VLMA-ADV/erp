'use client'

import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { usePermissionsContext } from '@/lib/contexts/permissions-context'
import SidebarItem from './sidebar-item'
import SidebarMenuPessoas from './sidebar-menu-pessoas'
import SidebarMenuConfiguracao from './sidebar-menu-configuracao'
import SidebarMenuFaturamento from './sidebar-menu-faturamento'
import SidebarMenuContratos from './sidebar-menu-contratos'
import SidebarMenuRelatorios from './sidebar-menu-relatorios'
import Novidades from './novidades'
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
    label: 'Despesas dos casos',
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
          <div className="h-8 bg-hairline rounded mb-4"></div>
          <div className="space-y-2">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-10 bg-hairline rounded"></div>
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
        <span className="text-eyebrow">VLMA</span>
        <h1 className="mt-1 text-lg font-light text-ink">ERP</h1>
        <Novidades />
      </SidebarHeader>
      <SidebarContent>
        {/* Menu Configuração (Expansível) */}
        <SidebarMenuConfiguracao pathname={pathname} hasPermission={checkPermission} />

        {/* Menu Pessoas (Expansível) */}
        <SidebarMenuPessoas pathname={pathname} hasPermission={checkPermission} />

        {/* Dashboard e CRM */}
        {['/home', '/crm'].map((href) => {
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

        {/* Menu Contratos (Expansível — inclui Contratos e Solicitações de Contrato) */}
        <SidebarMenuContratos pathname={pathname} hasPermission={checkPermission} />

        {/* Timesheet e Despesas */}
        {['/timesheet', '/despesas'].map((href) => {
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

        {/* PDI */}
        {(() => {
          const item = menuItems.find((m) => m.href === '/avaliacoes-pdi')
          if (!item || !checkPermission(item.permission)) return null
          return (
            <SidebarItem
              href={item.href}
              label={item.label}
              active={pathname === item.href}
            />
          )
        })()}

        {/* Menu Relatórios (Expansível) */}
        <SidebarMenuRelatorios pathname={pathname} hasPermission={checkPermission} />
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
