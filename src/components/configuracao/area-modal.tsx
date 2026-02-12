'use client'

import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface Area {
  id: string
  nome: string
  codigo: string
  ativo: boolean
}

interface AreaModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  area?: Area | null
  onSuccess: () => void
  onError: (error: string) => void
}

export default function AreaModal({
  open,
  onOpenChange,
  area,
  onSuccess,
  onError,
}: AreaModalProps) {
  const [formData, setFormData] = useState({ nome: '', codigo: '' })
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (area) {
      setFormData({
        nome: area.nome,
        codigo: area.codigo,
      })
    } else {
      setFormData({ nome: '', codigo: '' })
    }
  }, [area, open])

  const handleSubmit = async () => {
    if (!formData.nome.trim() || !formData.codigo.trim()) {
      onError('Nome e código são obrigatórios')
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

      const url = area
        ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/update-area`
        : `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/create-area`

      const body = area
        ? {
            id: area.id,
            nome: formData.nome,
            codigo: formData.codigo,
          }
        : {
            nome: formData.nome,
            codigo: formData.codigo,
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
        onError(data.error || `Erro ao ${area ? 'atualizar' : 'criar'} centro de custo`)
        return
      }

      onOpenChange(false)
      onSuccess()
    } catch (err) {
      console.error('Error saving area:', err)
      onError(`Erro ao ${area ? 'atualizar' : 'criar'} centro de custo`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{area ? 'Editar Centro de custo' : 'Novo Centro de custo'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="nome">Nome *</Label>
            <Input
              id="nome"
              value={formData.nome}
              onChange={(e) => setFormData({ ...formData, nome: e.target.value })}
              placeholder="Ex: Direito Trabalhista"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="codigo">Código *</Label>
            <Input
              id="codigo"
              value={formData.codigo}
              onChange={(e) => setFormData({ ...formData, codigo: e.target.value })}
              placeholder="Ex: TRAB"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading ? 'Salvando...' : area ? 'Atualizar' : 'Criar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
