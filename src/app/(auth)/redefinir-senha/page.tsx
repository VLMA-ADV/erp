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

  // Trocar código por sessão de recovery no servidor quando a página carrega
  // Isso garante que a sessão esteja ativa antes do usuário preencher o formulário
  if (params.code) {
    try {
      const supabase = await createClient()
      // Trocar o código de recovery por uma sessão
      const { data, error } = await supabase.auth.exchangeCodeForSession(params.code)
      
      if (error) {
        console.error('Error exchanging recovery code for session:', error)
        // Não mostrar erro aqui - deixar o cliente tentar também
        // O erro será mostrado quando o usuário tentar atualizar a senha
      } else if (data.session) {
        // Sessão criada com sucesso - o usuário já está autenticado
        // O formulário pode atualizar a senha diretamente
      }
    } catch (err) {
      console.error('Exception exchanging recovery code:', err)
      // Não mostrar erro aqui - deixar o cliente tentar também
    }
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
