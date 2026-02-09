'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Tooltip } from '@/components/ui/tooltip'
import { Edit, Power } from 'lucide-react'

interface Area {
  id: string
  nome: string
  codigo: string
  ativo: boolean
}

interface AreasActionsProps {
  area: Area
  canEdit: boolean
  onEdit: (area: Area) => void
  onRefresh: () => void
}

export default function AreasActions({
  area,
  canEdit,
  onEdit,
  onRefresh,
}: AreasActionsProps) {
  const [loading, setLoading] = useState(false)

  const handleToggleStatus = async () => {
    if (!confirm(`Tem certeza que deseja ${area.ativo ? 'desativar' : 'ativar'} esta área?`)) {
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
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/toggle-area-status`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ id: area.id }),
        }
      )

      const data = await response.json()

      if (!response.ok) {
        alert(data.error || 'Erro ao alterar status da área')
        return
      }

      onRefresh()
    } catch (error) {
      console.error('Error toggling status:', error)
      alert('Erro ao alterar status da área')
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
              onClick={() => onEdit(area)}
              className="h-8 w-8"
            >
              <Edit className="h-4 w-4" />
            </Button>
          </Tooltip>
          <Tooltip content={area.ativo ? 'Desativar' : 'Ativar'}>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleToggleStatus}
              disabled={loading}
              className="h-8 w-8"
            >
              <Power className={`h-4 w-4 ${area.ativo ? 'text-red-600' : 'text-green-600'}`} />
            </Button>
          </Tooltip>
        </>
      )}
    </div>
  )
}
