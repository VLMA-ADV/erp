'use client'

import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface GrupoEconomico {
  id: string
  nome: string
  ativo: boolean
  created_at: string
}

interface GrupoEconomicoModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  grupo?: GrupoEconomico | null
  onSuccess: () => void
  onError: (error: string) => void
}

export default function GrupoEconomicoModal({
  open,
  onOpenChange,
  grupo,
  onSuccess,
  onError,
}: GrupoEconomicoModalProps) {
  const [formData, setFormData] = useState({ nome: '' })
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (grupo) {
      setFormData({
        nome: grupo.nome,
      })
    } else {
      setFormData({ nome: '' })
    }
  }, [grupo, open])

  const handleSubmit = async () => {
    if (!formData.nome.trim()) {
      onError('Nome é obrigatório')
      return
    }

    try {
      setLoading(true)
      const { createClient } = await import('@/lib/supabase/client')
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()

      if (!session) {
        onError('Sessão expirada. Por favor, faça login novamente.')
        return
      }

      const url = grupo
        ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/update-grupo-economico`
        : `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/create-grupo-economico`

      const body = grupo
        ? {
            id: grupo.id,
            nome: formData.nome,
          }
        : {
            nome: formData.nome,
          }

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })

      const data = await response.json()

      if (!response.ok) {
        onError(data.error || `Erro ao ${grupo ? 'atualizar' : 'criar'} grupo`)
        return
      }

      onOpenChange(false)
      onSuccess()
    } catch (err) {
      console.error('Error saving grupo:', err)
      onError(`Erro ao ${grupo ? 'atualizar' : 'criar'} grupo`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{grupo ? 'Editar Grupo Econômico' : 'Novo Grupo Econômico'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="nome">Nome *</Label>
            <Input
              id="nome"
              value={formData.nome}
              onChange={(e) => setFormData({ ...formData, nome: e.target.value })}
              placeholder="Ex: Grupo ABC"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading ? 'Salvando...' : grupo ? 'Atualizar' : 'Criar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
