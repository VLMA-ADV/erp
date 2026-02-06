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
    // Verificar se há code na URL
    const code = searchParams.get('code')
    const email = searchParams.get('email')
    
    if (!code) {
      setTokenValid(false)
      setError('Link inválido ou expirado. Solicite um novo link de recuperação.')
      setIsExchanging(false)
      return
    }

    // Criar sessão de recovery imediatamente ao carregar a página
    const createRecoverySession = async () => {
      setIsExchanging(true)
      const supabase = createClient()
      
      try {
        // Tentar verificar o OTP com email primeiro (mais confiável)
        if (email) {
          const { data: verifyData, error: verifyError } = await supabase.auth.verifyOtp({
            email: decodeURIComponent(email),
            token: code,
            type: 'recovery',
          })

          if (verifyError) {
            console.error('Error verifying recovery OTP:', verifyError)
            setTokenValid(false)
            setError(verifyError.message || 'Link inválido ou expirado. Solicite um novo link de recuperação.')
            setIsExchanging(false)
            return
          }

          if (verifyData?.session) {
            console.log('Recovery session created successfully:', verifyData.session.user.id)
            setTokenValid(true)
            setIsExchanging(false)
            return
          }
        }

        // Se não temos email ou verifyOtp com email falhou, tentar usar apenas o código
        const { data: verifyData2, error: verifyError2 } = await supabase.auth.verifyOtp({
          token: code,
          type: 'recovery',
        })

        if (verifyError2) {
          console.error('Error verifying recovery token:', verifyError2)
          setTokenValid(false)
          setError(verifyError2.message || 'Link inválido ou expirado. Solicite um novo link de recuperação.')
          setIsExchanging(false)
          return
        }

        if (verifyData2?.session) {
          console.log('Recovery session created successfully:', verifyData2.session.user.id)
          setTokenValid(true)
        } else {
          console.error('No session returned from verification')
          setTokenValid(false)
          setError('Erro ao criar sessão de recuperação. Tente novamente.')
        }
      } catch (err) {
        console.error('Exception creating recovery session:', err)
        setTokenValid(false)
        setError('Erro ao validar o link. Tente novamente.')
      } finally {
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
