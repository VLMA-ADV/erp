import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import ForgotPasswordForm from '@/components/auth/forgot-password-form'

export const dynamic = 'force-dynamic'

export default async function RecuperarSenhaPage() {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()

  if (session) {
    redirect('/home')
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12 sm:px-6 lg:px-8">
      <div className="w-full max-w-md space-y-8">
        <div>
          <h2 className="mt-6 text-center text-3xl font-bold tracking-tight text-gray-900">
            Recuperar Senha
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            Digite seu e-mail para receber o link de recuperação
          </p>
        </div>
        <ForgotPasswordForm />
      </div>
    </div>
  )
}
