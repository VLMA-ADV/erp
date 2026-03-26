'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'

type Mode = 'link' | 'direct'

export default function ResetSenhaAdmin() {
  const [email, setEmail] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [mode, setMode] = useState<Mode>('link')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ type: 'success' | 'error'; message: string; link?: string } | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setResult(null)

    try {
      const body: Record<string, string> = { email }
      if (mode === 'direct') body.newPassword = newPassword

      const resp = await fetch('/api/admin/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      const data = await resp.json()

      if (!resp.ok) {
        setResult({ type: 'error', message: data.error || 'Erro ao redefinir senha' })
        return
      }

      setResult({
        type: 'success',
        message: data.message,
        link: data.link,
      })
      setEmail('')
      setNewPassword('')
    } catch {
      setResult({ type: 'error', message: 'Erro de conexão' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className="max-w-lg">
      <CardHeader>
        <CardTitle>Redefinir Senha de Usuário</CardTitle>
        <CardDescription>
          Use este painel para redefinir a senha de um colaborador sem depender do e-mail automático.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-4 flex gap-2">
          <Button
            type="button"
            variant={mode === 'link' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setMode('link')}
          >
            Gerar link de recuperação
          </Button>
          <Button
            type="button"
            variant={mode === 'direct' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setMode('direct')}
          >
            Definir nova senha diretamente
          </Button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="email">E-mail do usuário</Label>
            <Input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="usuario@vlma.com.br"
              className="mt-1"
            />
          </div>

          {mode === 'direct' && (
            <div>
              <Label htmlFor="newPassword">Nova senha</Label>
              <Input
                id="newPassword"
                type="password"
                required
                minLength={8}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Mínimo 8 caracteres"
                className="mt-1"
              />
            </div>
          )}

          {result && (
            <div
              className={`rounded-md p-3 text-sm ${
                result.type === 'success'
                  ? 'bg-green-50 text-green-800'
                  : 'bg-red-50 text-red-800'
              }`}
            >
              <p>{result.message}</p>
              {result.link && (
                <div className="mt-2">
                  <p className="font-medium">Link de recuperação (copie e envie ao usuário):</p>
                  <p className="mt-1 break-all rounded bg-white px-2 py-1 font-mono text-xs">
                    {result.link}
                  </p>
                </div>
              )}
            </div>
          )}

          <Button type="submit" disabled={loading} className="w-full">
            {loading
              ? 'Processando...'
              : mode === 'link'
                ? 'Gerar link de recuperação'
                : 'Redefinir senha'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
