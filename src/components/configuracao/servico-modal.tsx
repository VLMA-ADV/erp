'use client'

import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface Servico {
  id: string
  nome: string
}

interface ServicoModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  servico?: Servico | null
  onSuccess: () => void
  onError: (error: string) => void
}

export default function ServicoModal({ open, onOpenChange, servico, onSuccess, onError }: ServicoModalProps) {
  const [nome, setNome] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setNome(servico?.nome || '')
  }, [servico, open])

  const handleSubmit = async () => {
    if (!nome.trim()) {
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

      const url = servico
        ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/update-servico`
        : `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/create-servico`

      const body = servico ? { id: servico.id, nome } : { nome }

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })

      const data = await response.json()
      if (!response.ok) {
        onError(data.error || `Erro ao ${servico ? 'atualizar' : 'criar'} serviço`)
        return
      }

      onOpenChange(false)
      onSuccess()
    } catch (err) {
      console.error(err)
      onError(`Erro ao ${servico ? 'atualizar' : 'criar'} serviço`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{servico ? 'Editar Serviço' : 'Novo Serviço'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="nome">Nome *</Label>
            <Input id="nome" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex: Consultoria Tributária" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={loading}>{loading ? 'Salvando...' : servico ? 'Atualizar' : 'Criar'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
