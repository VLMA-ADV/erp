'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default function ResetPasswordForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [tokenValid, setTokenValid] = useState<boolean | null>(null)
  const [isExchanging, setIsExchanging] = useState(true)

  useEffect(() => {
    const code = searchParams.get('code')
    const tokenHash = searchParams.get('token_hash')
    const type = searchParams.get('type')

    const hashParams = typeof window !== 'undefined'
      ? new URLSearchParams(window.location.hash.replace(/^#/, ''))
      : new URLSearchParams()
    const hashAccessToken = hashParams.get('access_token')
    const hashRefreshToken = hashParams.get('refresh_token')

    const createRecoverySession = async () => {
      setIsExchanging(true)
      const supabase = createClient()
      
      try {
        // 1) Se já existe sessão ativa (ex: link já autenticou), não valida token novamente
        const { data: sessionData } = await supabase.auth.getSession()
        if (sessionData.session) {
          setTokenValid(true)
          return
        }

        // 2) Fluxo hash (implicit): access_token + refresh_token
        if (hashAccessToken && hashRefreshToken) {
          const { error: setSessionError } = await supabase.auth.setSession({
            access_token: hashAccessToken,
            refresh_token: hashRefreshToken,
          })

          if (!setSessionError) {
            setTokenValid(true)
            return
          }
        }

        // 3) Fluxo PKCE: code
        if (code) {
          const { data: exchangeData, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
          if (!exchangeError && exchangeData.session) {
            setTokenValid(true)
            return
          }
        }

        // 4) Fluxo token_hash/type=recovery
        if (tokenHash && type === 'recovery') {
          const { data: verifyData, error: verifyError } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type: 'recovery',
          })

          if (!verifyError && verifyData.session) {
            setTokenValid(true)
            return
          }
        }

        // Nenhum fluxo conseguiu criar sessão de recovery
        setTokenValid(false)
        setError('Link inválido ou expirado. Solicite um novo link de recuperação.')
      } catch (err) {
        console.error('Exception creating recovery session:', err)
        setTokenValid(false)
        setError('Erro ao validar o link. Tente novamente.')
      } finally {
        // Limpar hash sensível da URL depois da troca da sessão
        if (typeof window !== 'undefined' && window.location.hash) {
          window.history.replaceState({}, document.title, window.location.pathname + window.location.search)
        }
        setIsExchanging(false)
      }
    }

    createRecoverySession()
  }, [searchParams])

  const validatePassword = (pwd: string): string | null => {
    if (pwd.length < 8) {
      return 'A senha deve ter pelo menos 8 caracteres'
    }
    if (!/(?=.*[a-z])/.test(pwd)) {
      return 'A senha deve conter pelo menos uma letra minúscula'
    }
    if (!/(?=.*[A-Z])/.test(pwd)) {
      return 'A senha deve conter pelo menos uma letra maiúscula'
    }
    if (!/(?=.*\d)/.test(pwd)) {
      return 'A senha deve conter pelo menos um número'
    }
    return null
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    // Validações
    if (password !== confirmPassword) {
      setError('As senhas não coincidem')
      return
    }

    const passwordError = validatePassword(password)
    if (passwordError) {
      setError(passwordError)
      return
    }

    setLoading(true)

    try {
      const supabase = createClient()
      
      // Verificar se há sessão ativa (já criada no useEffect)
      const { data: { session } } = await supabase.auth.getSession()
      
      if (!session) {
        setError('Sessão de recuperação não encontrada. Por favor, acesse o link de recuperação novamente.')
        setLoading(false)
        return
      }
      
      console.log('Updating password for user:', session.user.id)
      
      // Atualizar a senha usando a sessão de recovery ativa
      const { error: updateError } = await supabase.auth.updateUser({
        password: password,
      })

      if (updateError) {
        console.error('Error updating password:', updateError)
        setError(updateError.message || 'Erro ao redefinir senha. Tente novamente.')
        setLoading(false)
        return
      }

      // Senha atualizada com sucesso, fazer logout e redirecionar para login
      await supabase.auth.signOut()
      router.push('/login?passwordReset=success')
    } catch (err) {
      console.error('Error resetting password:', err)
      setError('Erro ao redefinir senha. Tente novamente.')
      setLoading(false)
    }
  }

  // Mostrar loading enquanto está trocando o código por sessão
  if (isExchanging) {
    return (
      <div className="mt-8 space-y-6">
        <div className="rounded-md bg-blue-50 p-4">
          <p className="text-sm text-blue-800">Validando link de recuperação...</p>
        </div>
      </div>
    )
  }

  // Mostrar erro se o token for inválido
  if (tokenValid === false) {
    return (
      <div className="mt-8 space-y-6">
        <div className="rounded-md bg-red-50 p-4">
          <p className="text-sm text-red-800">{error || 'Link inválido ou expirado. Solicite um novo link de recuperação.'}</p>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="mt-8 space-y-6">
      <div className="space-y-4 rounded-md shadow-sm">
        <div>
          <Label htmlFor="password">Nova Senha</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1"
            placeholder="••••••••"
          />
          <p className="mt-1 text-xs text-gray-500">
            Mínimo 8 caracteres, com letras maiúsculas, minúsculas e números
          </p>
        </div>
        <div>
          <Label htmlFor="confirmPassword">Confirmar Senha</Label>
          <Input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            required
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="mt-1"
            placeholder="••••••••"
          />
        </div>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 p-4">
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      <div>
        <Button
          type="submit"
          className="w-full"
          disabled={loading || tokenValid !== true}
        >
          {loading ? 'Redefinindo...' : 'Redefinir Senha'}
        </Button>
      </div>
    </form>
  )
}
