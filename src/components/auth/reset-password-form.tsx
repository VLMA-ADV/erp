'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { PasswordInput } from '@/components/ui/password-input'
import { Label } from '@/components/ui/label'

export default function ResetPasswordForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [tokenValid, setTokenValid] = useState<boolean | null>(null)

  useEffect(() => {
    // Verificar se há code ou token na URL
    const code = searchParams.get('code')
    const token = searchParams.get('token')
    
    if (!code && !token) {
      setTokenValid(false)
      setError('Link inválido ou expirado. Solicite um novo link de recuperação.')
      return
    }

    // Para reset de senha, apenas verificamos se há código
    // O código será validado quando o usuário atualizar a senha
    setTokenValid(true)
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
      const code = searchParams.get('code')
      
      // Para reset de senha, o Supabase valida o código automaticamente quando atualizamos a senha
      // Não precisamos verificar o OTP separadamente - apenas atualizar a senha
      // O código na URL será validado automaticamente pelo Supabase
      
      // Atualizar a senha - o Supabase valida o código de recovery automaticamente
      const { error: updateError } = await supabase.auth.updateUser({
        password: password,
      })

      if (updateError) {
        console.error('Error updating password:', updateError)
        
        // Se o erro for relacionado a token expirado ou inválido
        if (updateError.message.includes('expired') || 
            updateError.message.includes('invalid') || 
            updateError.message.includes('Token')) {
          setError('Link inválido ou expirado. Solicite um novo link de recuperação.')
        } else {
          setError(updateError.message || 'Erro ao redefinir senha. Tente novamente.')
        }
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

  if (tokenValid === false) {
    return (
      <div className="mt-8 space-y-6">
        <div className="rounded-md bg-red-50 p-4">
          <p className="text-sm text-red-800">{error}</p>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="mt-8 space-y-6">
      <div className="space-y-4 rounded-md shadow-sm">
        <div>
          <Label htmlFor="password">Nova Senha</Label>
          <PasswordInput
            id="password"
            name="password"
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
          <PasswordInput
            id="confirmPassword"
            name="confirmPassword"
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
