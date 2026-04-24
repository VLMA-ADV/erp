'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { validateCPF, formatCPF, validateOAB, formatPhone } from '@/lib/utils/validation'

export default function ColaboradorForm() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  // Form fields
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    nome: '',
    cpf: '',
    categoria: 'estagiario',
    oab: '',
    conta_contabil: '',
    cargo_id: '',
    whatsapp: '',
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    
    // Validações
    const validationError = validateForm()
    if (validationError) {
      setError(validationError)
      return
    }
    
    setLoading(true)

    try {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()

      if (!session) {
        router.push('/login')
        return
      }

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/create-colaborador`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            ...formData,
            role_ids: [], // TODO: Implement role selection
            beneficios: [], // TODO: Implement beneficios selection
          }),
        }
      )

      const data = await response.json()

      if (!response.ok) {
        setError(data.error || 'Erro ao criar colaborador')
        setLoading(false)
        return
      }

      router.push('/pessoas/colaboradores')
    } catch (err) {
      setError('Erro ao criar colaborador. Tente novamente.')
      setLoading(false)
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target
    
    // Formatação automática
    let formattedValue = value
    if (name === 'cpf') {
      formattedValue = formatCPF(value)
    } else if (name === 'whatsapp') {
      formattedValue = formatPhone(value)
    }
    
    setFormData((prev) => ({
      ...prev,
      [name]: formattedValue,
    }))
  }

  const validateForm = (): string | null => {
    if (!validateCPF(formData.cpf)) {
      return 'CPF inválido'
    }
    
    if (formData.categoria === 'advogado' && formData.oab && !validateOAB(formData.oab)) {
      return 'OAB deve estar no formato: OAB/SP 123456'
    }
    
    return null
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Dados Básicos</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="nome">Nome Completo *</Label>
            <Input
              id="nome"
              name="nome"
              required
              value={formData.nome}
              onChange={handleChange}
              className="mt-1"
            />
          </div>

          <div>
            <Label htmlFor="email">E-mail *</Label>
            <Input
              id="email"
              name="email"
              type="email"
              required
              value={formData.email}
              onChange={handleChange}
              className="mt-1"
            />
          </div>

          <div>
            <Label htmlFor="password">Senha Temporária *</Label>
            <Input
              id="password"
              name="password"
              type="password"
              required
              value={formData.password}
              onChange={handleChange}
              className="mt-1"
              placeholder="Senha que será enviada por e-mail"
            />
          </div>

          <div>
            <Label htmlFor="cpf">CPF *</Label>
            <Input
              id="cpf"
              name="cpf"
              required
              value={formData.cpf}
              onChange={handleChange}
              className="mt-1"
              placeholder="00000000000"
            />
          </div>

          <div>
            <Label htmlFor="categoria">Categoria *</Label>
            <NativeSelect
              id="categoria"
              name="categoria"
              required
              value={formData.categoria}
              onChange={handleChange}
              className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="socio">Sócio</option>
              <option value="advogado">Advogado</option>
              <option value="administrativo">Administrativo</option>
              <option value="estagiario">Estagiário</option>
            </NativeSelect>
          </div>

          {formData.categoria === 'advogado' && (
            <div>
              <Label htmlFor="oab">OAB *</Label>
              <Input
                id="oab"
                name="oab"
                required
                value={formData.oab}
                onChange={handleChange}
                className="mt-1"
                placeholder="OAB/SP 123456"
              />
            </div>
          )}

          <div>
            <Label htmlFor="conta_contabil">Conta Contábil</Label>
            <Input
              id="conta_contabil"
              name="conta_contabil"
              value={formData.conta_contabil}
              onChange={handleChange}
              className="mt-1"
              placeholder="Ex.: 1.1.02.0001"
            />
          </div>

          <div>
            <Label htmlFor="whatsapp">WhatsApp</Label>
            <Input
              id="whatsapp"
              name="whatsapp"
              value={formData.whatsapp}
              onChange={handleChange}
              className="mt-1"
              placeholder="(00) 00000-0000"
            />
          </div>
        </CardContent>
      </Card>

      {error && (
        <div className="rounded-md bg-red-50 p-4">
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      <div className="flex justify-end gap-4">
        <Button
          type="button"
          variant="outline"
          onClick={() => router.back()}
        >
          Cancelar
        </Button>
        <Button type="submit" disabled={loading}>
          {loading ? 'Salvando...' : 'Salvar'}
        </Button>
      </div>
    </form>
  )
}
