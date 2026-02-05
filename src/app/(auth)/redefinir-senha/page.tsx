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
  
  // A página deve ser acessível apenas para usuários autenticados
  // O link de reset cria a sessão automaticamente quando acessado
  // Se não houver sessão e não houver código, mostrar erro
  if (!session && !params.code && !params.token) {
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

  // Se há código, o Supabase cria a sessão automaticamente quando a página carrega
  // Não precisamos fazer nada manualmente - apenas verificar se há sessão

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
