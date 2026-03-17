'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Eye, Pencil, Paperclip, Plus, Power, Trash2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Tooltip } from '@/components/ui/tooltip'
import { AlertDialog } from '@/components/ui/alert-dialog'
import { useToast } from '@/components/ui/toast'
import AnexoModal from './anexo-modal'

export default function ContratosActions({
  contratoId,
  status,
  canWrite,
  onRefresh,
}: {
  contratoId: string
  status: 'rascunho' | 'solicitacao' | 'validacao' | 'ativo' | 'encerrado' | 'em_analise'
  canWrite: boolean
  onRefresh: () => void
}) {
  const [anexoOpen, setAnexoOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const { success, error: toastError } = useToast()
  const isPreActiveStatus = status === 'solicitacao' || status === 'validacao' || status === 'em_analise'
  const next = status === 'encerrado' ? 'ativo' : status === 'ativo' ? 'encerrado' : 'ativo'

  const toggleStatus = async () => {
    try {
      setLoading(true)
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return

      const resp = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/toggle-contrato-status`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ id: contratoId, status: next }),
      })

      const data = await resp.json()
      if (!resp.ok) {
        toastError(data.error || 'Erro ao alterar status do contrato')
        return
      }

      success(`Status alterado para ${next}`)
      onRefresh()
    } catch (e) {
      console.error(e)
      toastError('Erro ao alterar status do contrato')
    } finally {
      setLoading(false)
      setConfirmOpen(false)
    }
  }

  const deleteDraft = async () => {
    try {
      setLoading(true)
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return

      const resp = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/delete-contrato`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ id: contratoId }),
      })

      const data = await resp.json()
      if (!resp.ok) {
        toastError(data.error || 'Erro ao excluir rascunho')
        return
      }

      success('Rascunho excluído')
      onRefresh()
    } catch (e) {
      console.error(e)
      toastError('Erro ao excluir rascunho')
    } finally {
      setLoading(false)
      setDeleteOpen(false)
    }
  }

  return (
    <div className="flex items-center justify-end gap-2">
      <Tooltip content="Visualizar">
        <Link href={`/contratos/${contratoId}/editar?view=1`}>
          <Button variant="ghost" size="sm">
            <Eye className="h-4 w-4" />
          </Button>
        </Link>
      </Tooltip>

      {canWrite && (
        <>
          <Tooltip content="Editar">
            <Link href={`/contratos/${contratoId}/editar`}>
              <Button variant="ghost" size="sm">
                <Pencil className="h-4 w-4" />
              </Button>
            </Link>
          </Tooltip>

          <Tooltip content="Inserir anexo">
            <Button variant="ghost" size="sm" onClick={() => setAnexoOpen(true)}>
              <Paperclip className="h-4 w-4" />
            </Button>
          </Tooltip>

          <Tooltip content="Novo caso">
            <Link href={`/contratos/${contratoId}/casos/novo`}>
              <Button variant="ghost" size="sm">
                <Plus className="h-4 w-4" />
              </Button>
            </Link>
          </Tooltip>

          <Tooltip content={status === 'encerrado' || isPreActiveStatus ? 'Ativar contrato' : 'Encerrar contrato'}>
            <Button variant="ghost" size="sm" onClick={() => setConfirmOpen(true)} disabled={loading}>
              <Power className={`h-4 w-4 ${status === 'encerrado' || isPreActiveStatus ? 'text-green-600' : 'text-red-600'}`} />
            </Button>
          </Tooltip>

          {status === 'rascunho' && (
            <Tooltip content="Excluir rascunho">
              <Button variant="ghost" size="sm" onClick={() => setDeleteOpen(true)} disabled={loading}>
                <Trash2 className="h-4 w-4 text-red-600" />
              </Button>
            </Tooltip>
          )}

          <AnexoModal
            open={anexoOpen}
            onOpenChange={setAnexoOpen}
            mode="contrato"
            targetId={contratoId}
            onSuccess={onRefresh}
          />
          <AlertDialog
            open={confirmOpen}
            onOpenChange={setConfirmOpen}
            title={status === 'encerrado' || isPreActiveStatus ? 'Ativar contrato?' : 'Encerrar contrato?'}
            description={`Confirme para alterar o status para ${status === 'encerrado' || isPreActiveStatus ? 'ativo' : 'encerrado'}.`}
            confirmLabel="Confirmar"
            cancelLabel="Cancelar"
            onConfirm={toggleStatus}
            loading={loading}
          />
          <AlertDialog
            open={deleteOpen}
            onOpenChange={setDeleteOpen}
            title="Excluir contrato rascunho?"
            description="Essa ação remove o contrato rascunho e os dados vinculados."
            confirmLabel="Excluir"
            cancelLabel="Cancelar"
            onConfirm={deleteDraft}
            loading={loading}
          />
        </>
      )}
    </div>
  )
}
