'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import Link from 'next/link'

export default function ForgotPasswordForm() {
  const [email, setEmail] = useState('')
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      const supabase = createClient()
      // Sempre exibe mensagem de sucesso, mesmo se o e-mail não existir (por segurança)
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/redefinir-senha`,
      })
      
      if (error) {
        console.error('Error sending reset password email:', error)
        // Ainda mostra sucesso por segurança
      }
      
      setSuccess(true)
    } catch (err) {
      console.error('Exception sending reset password email:', err)
      // Não exibe erro, sempre mostra sucesso por segurança
      setSuccess(true)
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <div className="mt-8 space-y-6">
        <div className="rounded-md bg-green-50 p-4">
          <p className="text-sm text-green-800">
            Se o e-mail informado estiver cadastrado, você receberá um link para redefinir sua senha.
          </p>
        </div>
        <div className="text-center">
          <Link
            href="/login"
            className="text-sm font-medium text-primary hover:text-primary/80"
          >
            Voltar para o login
          </Link>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="mt-8 space-y-6">
      <div className="space-y-4 rounded-md shadow-sm">
        <div>
          <Label htmlFor="email">E-mail</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1"
            placeholder="seu@email.com"
          />
        </div>
      </div>

      <div>
        <Button
          type="submit"
          className="w-full"
          disabled={loading}
        >
          {loading ? 'Enviando...' : 'Enviar link de recuperação'}
        </Button>
      </div>

      <div className="text-center">
        <Link
          href="/login"
          className="text-sm font-medium text-primary hover:text-primary/80"
        >
          Voltar para o login
        </Link>
      </div>
    </form>
  )
}
