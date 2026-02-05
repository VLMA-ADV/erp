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
  const { data: { session } } = await supabase.auth.getSession()
  
  // Se há código na URL, processar no servidor primeiro
  if (params.code) {
    try {
      // Trocar código por sessão no servidor (onde os cookies são mais confiáveis)
      const { data, error } = await supabase.auth.exchangeCodeForSession(params.code)
      
      if (error) {
        console.error('Error exchanging code for session on server:', error)
        // Mesmo com erro, mostrar formulário - o cliente pode tentar também
      } else if (data.session) {
        // Sessão criada com sucesso no servidor
      }
    } catch (err) {
      console.error('Exception exchanging code on server:', err)
      // Mesmo com erro, mostrar formulário - o cliente pode tentar também
    }
  }
  
  // Se há código ou token, sempre mostrar o formulário
  if (params.code || params.token) {
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
  
  // Se não há código mas há sessão (usuário logado), permitir alterar senha
  if (session) {
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

  // Se não há código nem sessão, mostrar erro
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
