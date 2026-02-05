'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Tooltip } from '@/components/ui/tooltip'
import { Eye, Edit, Power, FileText } from 'lucide-react'

interface Colaborador {
  id: string
  nome: string
  ativo: boolean
}

interface ColaboradoresActionsProps {
  colaborador: Colaborador
  canEdit: boolean
  canView: boolean
  canViewPDI: boolean
  onRefresh: () => void
}

export default function ColaboradoresActions({
  colaborador,
  canEdit,
  canView,
  canViewPDI,
  onRefresh,
}: ColaboradoresActionsProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  const handleView = () => {
    router.push(`/pessoas/colaboradores/${colaborador.id}`)
  }

  const handleEdit = () => {
    router.push(`/pessoas/colaboradores/${colaborador.id}/editar`)
  }

  const handleToggleStatus = async () => {
    if (!confirm(`Tem certeza que deseja ${colaborador.ativo ? 'desativar' : 'ativar'} este colaborador?`)) {
      return
    }

    setLoading(true)
    try {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()

      if (!session) {
        return
      }

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/toggle-colaborador-status`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ id: colaborador.id }),
        }
      )

      const data = await response.json()

      if (!response.ok) {
        alert(data.error || 'Erro ao alterar status do colaborador')
        return
      }

      onRefresh()
    } catch (error) {
      console.error('Error toggling status:', error)
      alert('Erro ao alterar status do colaborador')
    } finally {
      setLoading(false)
    }
  }

  const handleViewPDI = () => {
    router.push(`/pessoas/colaboradores/${colaborador.id}/pdi`)
  }

  return (
    <div className="flex items-center justify-end gap-2">
      {canView && (
        <Tooltip content="Visualizar">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleView}
            className="h-8 w-8"
          >
            <Eye className="h-4 w-4" />
          </Button>
        </Tooltip>
      )}
      {canEdit && (
        <>
          <Tooltip content="Editar">
            <Button
              variant="ghost"
              size="icon"
              onClick={handleEdit}
              className="h-8 w-8"
            >
              <Edit className="h-4 w-4" />
            </Button>
          </Tooltip>
          <Tooltip content={colaborador.ativo ? 'Desativar' : 'Ativar'}>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleToggleStatus}
              disabled={loading}
              className="h-8 w-8"
            >
              <Power className={`h-4 w-4 ${colaborador.ativo ? 'text-red-600' : 'text-green-600'}`} />
            </Button>
          </Tooltip>
        </>
      )}
      {canViewPDI && (
        <Tooltip content="Ver avaliação de PDI">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleViewPDI}
            className="h-8 w-8"
          >
            <FileText className="h-4 w-4" />
          </Button>
        </Tooltip>
      )}
    </div>
  )
}
