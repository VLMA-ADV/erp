'use client'

import { usePathname } from 'next/navigation'
import { usePermissionsContext } from '@/lib/contexts/permissions-context'
import SidebarItem from './sidebar-item'
import SidebarMenuPessoas from './sidebar-menu-pessoas'
import SidebarMenuConfiguracao from './sidebar-menu-configuracao'
import SidebarMenuFaturamento from './sidebar-menu-faturamento'

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

export default function Sidebar() {
  const pathname = usePathname()
  const { hasPermission, loading } = usePermissionsContext()

  if (loading) {
    return (
      <aside className="w-64 border-r bg-gray-50 p-4">
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

  const renderMenuItem = (href: string) => {
    const item = menuItems.find((menuItem) => menuItem.href === href)

    if (!item || !hasPermission(item.permission)) {
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
  }

  return (
    <aside className="w-64 border-r bg-gray-50 p-4">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">ERP-VLMA</h1>
      </div>
      <nav className="space-y-1">
        {/* Menu Configuração (Expansível) */}
        <SidebarMenuConfiguracao pathname={pathname} hasPermission={hasPermission} />

        {/* Menu Pessoas (Expansível) */}
        <SidebarMenuPessoas pathname={pathname} hasPermission={hasPermission} />

        {/* Outros itens do menu */}
        {renderMenuItem('/home')}
        {renderMenuItem('/crm')}
        {renderMenuItem('/solicitacoes-contrato')}
        {renderMenuItem('/contratos')}
        {renderMenuItem('/timesheet')}
        {renderMenuItem('/despesas')}

        {/* Menu Faturamento (Expansível) */}
        <SidebarMenuFaturamento pathname={pathname} hasPermission={hasPermission} />

        {renderMenuItem('/avaliacoes-pdi')}
        {renderMenuItem('/relatorios')}
      </nav>
    </aside>
  )
}
