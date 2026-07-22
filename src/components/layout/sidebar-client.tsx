'use client'

import Link from 'next/link'
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
import { VlmaLogo } from '@/components/ui/vlma-logo'
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
    label: 'Contas a pagar e receber',
    href: '/financeiro/contas-a-pagar',
    permission: 'finance.contas_pagar.read',
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
  const { hasPermission, loading, permissions, isGestorModulos } = usePermissionsContext()

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

  // Skeleton só na primeira carga (sem permissões ainda). Depois de carregadas,
  // um refresh em background não deve blanknar o menu — evita o "recarregando sozinho".
  if (loading && permissions.length === 0) {
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

  // Gate de módulos por perfil (pedido Filipe 22/07): CRM, Contratos, Financeiro,
  // PDI e os demais módulos gerenciais só aparecem para SÓCIO ou COORDENADOR.
  // Todos os outros (advogado, estagiário, administrativo não-coordenador) veem
  // apenas Clientes, Timesheet e Despesas — o suficiente para localizar cliente/caso
  // e lançar horas/despesas. Fail-safe: se o perfil ainda não carregou,
  // isGestorModulos = false → menu mínimo (nunca abre tudo por engano, como
  // acontecia no antigo "showAllItems").
  const checkPermission = (permission: string) => hasPermission(permission)

  // Menu enxuto para quem não é gestor de módulos.
  if (!isGestorModulos) {
    const minItems = [
      { label: 'Clientes', href: '/pessoas/clientes' },
      { label: 'Timesheet', href: '/timesheet' },
      { label: 'Despesas dos casos', href: '/despesas' },
      // Todo colaborador enxerga e edita o PRÓPRIO PDI (autoavaliação do ciclo).
      // Vai direto para /meu — a página é escopada ao próprio usuário
      // (get_minha_avaliacao_pdi); o hub /avaliacoes-pdi é para gestores.
      { label: 'Meu PDI', href: '/avaliacoes-pdi/meu' },
    ]
    return (
      <Sidebar className="bg-brand-purple-soft border-r-brand-purple/15">
        <SidebarHeader>
          <div className="text-ink"><VlmaLogo className="h-5 w-auto" /></div>
          <div className="mt-1.5 flex items-center gap-2">
            <span className="text-sm font-medium text-ink">ERP</span>
            <Novidades />
          </div>
        </SidebarHeader>
        <SidebarContent>
          {minItems.map((item) => (
            <SidebarItem
              key={item.href}
              href={item.href}
              label={item.label}
              active={pathname === item.href}
            />
          ))}
        </SidebarContent>
        <SidebarFooter>
          <Link href="/perfil" className="w-full">
            <Button variant="ghost" className="w-full justify-center">
              Meu perfil
            </Button>
          </Link>
          <Button variant="outline" className="w-full" onClick={handleLogout}>
            Sair
          </Button>
        </SidebarFooter>
      </Sidebar>
    )
  }

  return (
    <Sidebar className="bg-brand-purple-soft border-r-brand-purple/15">
      <SidebarHeader>
        <div className="text-ink"><VlmaLogo className="h-5 w-auto" /></div>
        <div className="mt-1.5 flex items-center gap-2">
          <span className="text-sm font-medium text-ink">ERP</span>
          <Novidades />
        </div>
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

        {/* Contas a pagar e receber — módulo financeiro-gerencial à parte do faturamento */}
        {(() => {
          const item = menuItems.find((m) => m.href === '/financeiro/contas-a-pagar')
          if (!item || !checkPermission(item.permission)) return null
          return (
            <SidebarItem
              href={item.href}
              label={item.label}
              active={pathname === item.href}
            />
          )
        })()}

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
      
      {/* Perfil + Logout */}
      <SidebarFooter>
        <Link href="/perfil" className="w-full">
          <Button variant="ghost" className="w-full justify-center">
            Meu perfil
          </Button>
        </Link>
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
