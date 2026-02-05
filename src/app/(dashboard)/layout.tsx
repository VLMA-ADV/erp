import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Suspense } from 'react'
import SidebarClient from '@/components/layout/sidebar-client'
import { PermissionsProvider } from '@/lib/contexts/permissions-context'

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
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()

  if (!session) {
    redirect('/login')
  }

  return (
    <PermissionsProvider>
      <div className="flex h-screen">
        <Suspense fallback={<SidebarFallback />}>
          <SidebarClient />
        </Suspense>
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </PermissionsProvider>
  )
}
