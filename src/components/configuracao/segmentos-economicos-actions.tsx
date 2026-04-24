'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Tooltip } from '@/components/ui/tooltip'
import { Edit, Power } from 'lucide-react'

interface SegmentoEconomico {
  id: string
  nome: string
  ativo: boolean
}

interface SegmentosEconomicosActionsProps {
  segmento: SegmentoEconomico
  canEdit: boolean
  onEdit: (segmento: SegmentoEconomico) => void
  onRefresh: () => void
}

export default function SegmentosEconomicosActions({
  segmento,
  canEdit,
  onEdit,
  onRefresh,
}: SegmentosEconomicosActionsProps) {
  const [loading, setLoading] = useState(false)

  const handleToggleStatus = async () => {
    if (!confirm(`Tem certeza que deseja ${segmento.ativo ? 'desativar' : 'ativar'} este segmento?`)) {
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
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/toggle-segmento-economico-status`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ id: segmento.id }),
        }
      )

      const data = await response.json()

      if (!response.ok) {
        alert(data.error || 'Erro ao alterar status do segmento')
        return
      }

      onRefresh()
    } catch (error) {
      console.error('Error toggling status:', error)
      alert('Erro ao alterar status do segmento')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex items-center justify-end gap-2">
      {canEdit && (
        <>
          <Tooltip content="Editar">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onEdit(segmento)}
              className="h-8 w-8"
            >
              <Edit className="h-4 w-4" />
            </Button>
          </Tooltip>
          <Tooltip content={segmento.ativo ? 'Desativar' : 'Ativar'}>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleToggleStatus}
              disabled={loading}
              className="h-8 w-8"
            >
              <Power className={`h-4 w-4 ${segmento.ativo ? 'text-red-600' : 'text-green-600'}`} />
            </Button>
          </Tooltip>
        </>
      )}
    </div>
  )
}
