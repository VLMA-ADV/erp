import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import LoginForm from '@/components/auth/login-form'

export const dynamic = 'force-dynamic'

export default async function LoginPage() {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()

  if (session) {
    redirect('/home')
  }

  return (
    <div className="gradient-mesh flex min-h-screen items-center justify-center bg-canvas-soft px-4 py-12 sm:px-6 lg:px-8">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <span className="text-eyebrow">VLMA · ERP</span>
          <h2 className="mt-3 display-md text-ink">Entre na sua conta</h2>
          <p className="mt-2 text-sm text-ink-mute">
            Sistema Voa Legal Marcas e Advocacia
          </p>
        </div>
        <LoginForm />
      </div>
    </div>
  )
}
