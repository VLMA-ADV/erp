'use client'

import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface Cargo {
  id: string
  nome: string
  codigo: string
  nivel?: number | null
  ativo: boolean
}

interface CargoModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  cargo?: Cargo | null
  onSuccess: () => void
  onError: (error: string) => void
}

export default function CargoModal({
  open,
  onOpenChange,
  cargo,
  onSuccess,
  onError,
}: CargoModalProps) {
  const [formData, setFormData] = useState({ nome: '', codigo: '', nivel: '' })
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (cargo) {
      setFormData({
        nome: cargo.nome,
        codigo: cargo.codigo,
        nivel: cargo.nivel?.toString() || '',
      })
    } else {
      setFormData({ nome: '', codigo: '', nivel: '' })
    }
  }, [cargo, open])

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

      const url = cargo
        ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/update-cargo`
        : `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/create-cargo`

      const body = cargo
        ? {
            id: cargo.id,
            nome: formData.nome,
            codigo: formData.codigo,
            nivel: formData.nivel ? parseInt(formData.nivel) : null,
          }
        : {
            nome: formData.nome,
            codigo: formData.codigo,
            nivel: formData.nivel ? parseInt(formData.nivel) : null,
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
        onError(data.error || `Erro ao ${cargo ? 'atualizar' : 'criar'} cargo`)
        return
      }

      onOpenChange(false)
      onSuccess()
    } catch (err) {
      console.error('Error saving cargo:', err)
      onError(`Erro ao ${cargo ? 'atualizar' : 'criar'} cargo`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{cargo ? 'Editar Cargo' : 'Novo Cargo'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="nome">Nome *</Label>
            <Input
              id="nome"
              value={formData.nome}
              onChange={(e) => setFormData({ ...formData, nome: e.target.value })}
              placeholder="Ex: Advogado Sênior"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="codigo">Código *</Label>
            <Input
              id="codigo"
              value={formData.codigo}
              onChange={(e) => setFormData({ ...formData, codigo: e.target.value })}
              placeholder="Ex: ADV_SEN"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="nivel">Nível</Label>
            <Input
              id="nivel"
              type="number"
              value={formData.nivel}
              onChange={(e) => setFormData({ ...formData, nivel: e.target.value })}
              placeholder="Nível hierárquico (opcional)"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading ? 'Salvando...' : cargo ? 'Atualizar' : 'Criar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
