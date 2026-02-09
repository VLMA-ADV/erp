'use client'

import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface SegmentoEconomico {
  id: string
  nome: string
  ativo: boolean
}

interface SegmentoEconomicoModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  segmento?: SegmentoEconomico | null
  onSuccess: () => void
  onError: (error: string) => void
}

export default function SegmentoEconomicoModal({
  open,
  onOpenChange,
  segmento,
  onSuccess,
  onError,
}: SegmentoEconomicoModalProps) {
  const [formData, setFormData] = useState({ nome: '' })
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (segmento) {
      setFormData({
        nome: segmento.nome,
      })
    } else {
      setFormData({ nome: '' })
    }
  }, [segmento, open])

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

      const url = segmento
        ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/update-segmento-economico`
        : `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/create-segmento-economico`

      const body = segmento
        ? {
            id: segmento.id,
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
        onError(data.error || `Erro ao ${segmento ? 'atualizar' : 'criar'} segmento`)
        return
      }

      onOpenChange(false)
      onSuccess()
    } catch (err) {
      console.error('Error saving segmento:', err)
      onError(`Erro ao ${segmento ? 'atualizar' : 'criar'} segmento`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{segmento ? 'Editar Segmento Econômico' : 'Novo Segmento Econômico'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="nome">Nome *</Label>
            <Input
              id="nome"
              value={formData.nome}
              onChange={(e) => setFormData({ ...formData, nome: e.target.value })}
              placeholder="Ex: Tecnologia"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading ? 'Salvando...' : segmento ? 'Atualizar' : 'Criar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
