'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

function validatePassword(pwd: string): string | null {
  if (pwd.length < 8) return 'A senha deve ter pelo menos 8 caracteres'
  if (!/(?=.*[a-z])/.test(pwd)) return 'A senha deve conter pelo menos uma letra minúscula'
  if (!/(?=.*[A-Z])/.test(pwd)) return 'A senha deve conter pelo menos uma letra maiúscula'
  if (!/(?=.*\d)/.test(pwd)) return 'A senha deve conter pelo menos um número'
  return null
}

export default function AlterarSenhaForm() {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSaved(false)

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
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        setError('Sessão expirada. Entre novamente para alterar a senha.')
        return
      }
      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) {
        setError(updateError.message || 'Erro ao alterar a senha. Tente novamente.')
        return
      }
      setSaved(true)
      setPassword('')
      setConfirmPassword('')
    } catch (err) {
      setError((err as Error).message || 'Erro ao alterar a senha.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-md space-y-4 rounded-xl border border-hairline bg-card p-6">
      <div className="space-y-2">
        <Label htmlFor="nova-senha">Nova senha</Label>
        <Input
          id="nova-senha"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Mínimo 8 caracteres, com maiúscula, minúscula e número"
          disabled={loading}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirmar-senha">Confirmar nova senha</Label>
        <Input
          id="confirmar-senha"
          type="password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          placeholder="Repita a nova senha"
          disabled={loading}
        />
      </div>

      {error ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      ) : null}
      {saved ? (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3">
          <p className="text-sm text-emerald-700">Senha alterada com sucesso.</p>
        </div>
      ) : null}

      <Button type="submit" className="w-full" disabled={loading || !password || !confirmPassword}>
        {loading ? 'Salvando...' : 'Alterar senha'}
      </Button>
    </form>
  )
}
