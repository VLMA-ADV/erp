import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import ResetPasswordForm from '@/components/auth/reset-password-form'

export const dynamic = 'force-dynamic'

export default async function RedefinirSenhaPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; token?: string }>
}) {
  const params = await searchParams
  const supabase = await createClient()
  
  // Se houver código na URL, trocar por sessão
  if (params.code) {
    const { error } = await supabase.auth.exchangeCodeForSession(params.code)
    if (error) {
      console.error('Error exchanging code for session:', error)
      // Se houver erro, mostrar mensagem de erro
      return (
        <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12 sm:px-6 lg:px-8">
          <div className="w-full max-w-md space-y-8">
            <div>
              <h2 className="mt-6 text-center text-3xl font-bold tracking-tight text-gray-900">
                Redefinir Senha
              </h2>
              <p className="mt-2 text-center text-sm text-gray-600">
                Link inválido ou expirado
              </p>
            </div>
            <div className="rounded-md bg-red-50 p-4">
              <p className="text-sm text-red-800">
                Link inválido ou expirado. Solicite um novo link de recuperação.
              </p>
            </div>
          </div>
        </div>
      )
    }
  }

  const { data: { session } } = await supabase.auth.getSession()

  // Se não houver código nem token na URL, mostrar erro
  if (!params.code && !params.token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12 sm:px-6 lg:px-8">
        <div className="w-full max-w-md space-y-8">
          <div>
            <h2 className="mt-6 text-center text-3xl font-bold tracking-tight text-gray-900">
              Redefinir Senha
            </h2>
            <p className="mt-2 text-center text-sm text-gray-600">
              Link inválido ou expirado
            </p>
          </div>
          <div className="rounded-md bg-red-50 p-4">
            <p className="text-sm text-red-800">
              Link inválido ou expirado. Solicite um novo link de recuperação.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12 sm:px-6 lg:px-8">
      <div className="w-full max-w-md space-y-8">
        <div>
          <h2 className="mt-6 text-center text-3xl font-bold tracking-tight text-gray-900">
            Redefinir Senha
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            Digite sua nova senha
          </p>
        </div>
        <ResetPasswordForm />
      </div>
    </div>
  )
}
