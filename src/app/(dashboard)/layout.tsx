import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Suspense } from 'react'
import SidebarClient from '@/components/layout/sidebar-client'
import { PermissionsProvider } from '@/lib/contexts/permissions-context'
import PageBreadcrumb from '@/components/layout/page-breadcrumb'
import { SonnerProvider } from '@/components/ui/sonner'
import { ReactQueryProvider } from '@/components/providers/react-query-provider'

export const dynamic = 'force-dynamic'

function SidebarFallback() {
  return (
    <aside className="w-64 border-r border-hairline bg-canvas-soft p-4">
      <div className="animate-pulse">
        <div className="h-8 bg-hairline rounded mb-4"></div>
        <div className="space-y-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-10 bg-hairline rounded"></div>
          ))}
        </div>
      </div>
    </aside>
  )
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  let user = null

  try {
    const supabase = await createClient()
    // getUser() valida o JWT com o servidor de Auth (getSession só lê o cookie,
    // sem revalidar). Em gate de servidor, usar getUser é o correto.
    const { data, error } = await supabase.auth.getUser()
    if (error) throw error
    user = data.user
  } catch (error) {
    console.error('Error in DashboardLayout:', error)
    // Se houver erro ao validar o usuário, redireciona para login
    redirect('/login')
  }

  if (!user) {
    redirect('/login')
  }

  return (
    <ReactQueryProvider>
      <PermissionsProvider>
        <SonnerProvider>
          <div className="flex h-screen">
            <Suspense fallback={<SidebarFallback />}>
              <SidebarClient />
            </Suspense>
            <main className="flex-1 overflow-y-auto">
              <div className="sticky top-0 z-10 border-b border-hairline bg-canvas/95 px-6 py-3 backdrop-blur-sm">
                <PageBreadcrumb />
              </div>
              {children}
            </main>
          </div>
        </SonnerProvider>
      </PermissionsProvider>
    </ReactQueryProvider>
  )
}
