import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Suspense } from 'react'
import SidebarClient from '@/components/layout/sidebar-client'
import { PermissionsProvider } from '@/lib/contexts/permissions-context'
import PageBreadcrumb from '@/components/layout/page-breadcrumb'
import { SonnerProvider } from '@/components/ui/sonner'

export const dynamic = 'force-dynamic'

function SidebarFallback() {
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

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  let session = null
  
  try {
    const supabase = await createClient()
    const { data } = await supabase.auth.getSession()
    session = data.session
  } catch (error) {
    console.error('Error in DashboardLayout:', error)
    // Se houver erro ao criar cliente, redireciona para login
    redirect('/login')
  }

  if (!session) {
    redirect('/login')
  }

  return (
    <PermissionsProvider>
      <SonnerProvider>
        <div className="flex h-screen">
          <Suspense fallback={<SidebarFallback />}>
            <SidebarClient />
          </Suspense>
          <main className="flex-1 overflow-y-auto">
            <div className="sticky top-0 z-10 border-b bg-white/95 px-6 py-3 backdrop-blur-sm">
              <PageBreadcrumb />
            </div>
            {children}
          </main>
        </div>
      </SonnerProvider>
    </PermissionsProvider>
  )
}
