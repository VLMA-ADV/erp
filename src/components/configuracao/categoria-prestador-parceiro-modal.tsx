'use client'

import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface CategoriaItem {
  id: string
  nome: string
  ativo: boolean
}

export default function CategoriaPrestadorParceiroModal({
  open,
  onOpenChange,
  item,
  onSuccess,
  onError,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  item?: CategoriaItem | null
  onSuccess: () => void
  onError: (error: string) => void
}) {
  const [nome, setNome] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setNome(item?.nome || '')
  }, [item, open])

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
        onError('Sessão expirada. Faça login novamente.')
        return
      }

      const url = item
        ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/update-categoria-prestador-parceiro`
        : `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/create-categoria-prestador-parceiro`

      const body = item ? { id: item.id, nome, ativo: item.ativo } : { nome }

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
        onError(data.error || `Erro ao ${item ? 'atualizar' : 'criar'} categoria`)
        return
      }

      onOpenChange(false)
      onSuccess()
    } catch (err) {
      console.error(err)
      onError(`Erro ao ${item ? 'atualizar' : 'criar'} categoria`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{item ? 'Editar categoria' : 'Nova categoria'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="nome">Nome *</Label>
            <Input id="nome" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex: Correspondente externo" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={loading}>{loading ? 'Salvando...' : item ? 'Atualizar' : 'Criar'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
