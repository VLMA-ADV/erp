'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Eye, Pencil, Paperclip, Power } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Tooltip } from '@/components/ui/tooltip'
import { AlertDialog } from '@/components/ui/alert-dialog'
import { useToast } from '@/components/ui/toast'
import AnexoModal from './anexo-modal'

export default function CasosActions({
  contratoId,
  casoId,
  status = 'ativo',
  canWrite,
  onRefresh,
}: {
  contratoId: string
  casoId: string
  status?: 'rascunho' | 'ativo' | 'inativo'
  canWrite: boolean
  onRefresh: () => void
}) {
  const [anexoOpen, setAnexoOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const { success, error: toastError } = useToast()

  const toggleStatus = async () => {
    const next = status === 'inativo' ? 'ativo' : 'inativo'
    try {
      setLoading(true)
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return

      const resp = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/toggle-caso-status`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ id: casoId, status: next }),
      })

      const data = await resp.json()
      if (!resp.ok) {
        toastError(data.error || 'Erro ao alterar status do caso')
        return
      }

      success(`Caso ${next === 'inativo' ? 'encerrado' : 'ativado'} com sucesso`)
      onRefresh()
    } catch (e) {
      console.error(e)
      toastError('Erro ao alterar status do caso')
    } finally {
      setLoading(false)
      setConfirmOpen(false)
    }
  }

  return (
    <div className="flex items-center justify-end gap-2">
      <Tooltip content="Visualizar">
        <Link href={`/contratos/${contratoId}/casos/${casoId}/editar?view=1`}>
          <Button variant="ghost" size="sm">
            <Eye className="h-4 w-4" />
          </Button>
        </Link>
      </Tooltip>
      {canWrite && (
        <>
          <Tooltip content="Editar">
            <Link href={`/contratos/${contratoId}/casos/${casoId}/editar`}>
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
          <Tooltip content={status === 'inativo' ? 'Ativar caso' : 'Encerrar caso'}>
            <Button variant="ghost" size="sm" onClick={() => setConfirmOpen(true)} disabled={loading}>
              <Power className={`h-4 w-4 ${status === 'inativo' ? 'text-green-600' : 'text-red-600'}`} />
            </Button>
          </Tooltip>
          <AnexoModal
            open={anexoOpen}
            onOpenChange={setAnexoOpen}
            mode="caso"
            targetId={casoId}
            onSuccess={onRefresh}
          />
          <AlertDialog
            open={confirmOpen}
            onOpenChange={setConfirmOpen}
            title={status === 'inativo' ? 'Ativar caso?' : 'Encerrar caso?'}
            description={`Confirme para alterar o status para ${status === 'inativo' ? 'ativo' : 'inativo'}.`}
            confirmLabel="Confirmar"
            cancelLabel="Cancelar"
            onConfirm={toggleStatus}
            loading={loading}
          />
        </>
      )}
    </div>
  )
}
