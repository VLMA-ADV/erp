'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Tooltip } from '@/components/ui/tooltip'
import { AlertDialog } from '@/components/ui/alert-dialog'
import { useToast } from '@/components/ui/toast'
import { createClient } from '@/lib/supabase/client'
import { Edit, Trash2 } from 'lucide-react'

interface ServicoProduto {
  id: string
  nome: string
}

interface ServicosProdutosActionsProps {
  servicoProduto: ServicoProduto
  canEdit: boolean
  onEdit: (servicoProduto: ServicoProduto) => void
  onRefresh: () => void
}

export default function ServicosProdutosActions({ servicoProduto, canEdit, onEdit, onRefresh }: ServicosProdutosActionsProps) {
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const { success, error: toastError } = useToast()

  if (!canEdit) return null

  const deleteServicoProduto = async () => {
    try {
      setLoading(true)
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()

      if (!session) {
        toastError('Sessão expirada. Por favor, faça login novamente.')
        return
      }

      const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/delete-servico-produto`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ id: servicoProduto.id }),
      })

      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        toastError(response.status === 409 && typeof data.error === 'string' ? data.error : 'Erro ao excluir produto')
        return
      }

      success('Produto excluído')
      onRefresh()
    } catch (err) {
      console.error(err)
      toastError('Erro ao excluir produto')
    } finally {
      setLoading(false)
      setDeleteOpen(false)
    }
  }

  return (
    <div className="flex items-center justify-end gap-2">
      <Tooltip content="Editar">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onEdit(servicoProduto)}
          className="h-8 w-8"
        >
          <Edit className="h-4 w-4" />
        </Button>
      </Tooltip>
      <Tooltip content="Excluir">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setDeleteOpen(true)}
          className="h-8 w-8"
          disabled={loading}
        >
          <Trash2 className="h-4 w-4 text-red-600" />
        </Button>
      </Tooltip>
      <AlertDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Excluir '${servicoProduto.nome}'?`}
        description="Esta ação não pode ser desfeita"
        confirmLabel="Excluir"
        cancelLabel="Cancelar"
        onConfirm={deleteServicoProduto}
        loading={loading}
      />
    </div>
  )
}
