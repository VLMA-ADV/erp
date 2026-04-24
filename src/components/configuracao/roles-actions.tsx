'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Tooltip } from '@/components/ui/tooltip'
import { Edit, Power, Eye } from 'lucide-react'

interface Role {
  id: string
  nome: string
  descricao: string | null
  ativo: boolean
}

interface RolesActionsProps {
  role: Role
  canEdit: boolean
  canView: boolean
  onEdit: (role: Role) => void | Promise<void>
  onView: (role: Role) => void | Promise<void>
  onRefresh: () => void
}

export default function RolesActions({
  role,
  canEdit,
  canView,
  onEdit,
  onView,
  onRefresh,
}: RolesActionsProps) {
  const [loading, setLoading] = useState(false)

  const handleToggleStatus = async () => {
    if (!confirm(`Tem certeza que deseja ${role.ativo ? 'desativar' : 'ativar'} esta role?`)) {
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
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/toggle-role-status`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ id: role.id }),
        }
      )

      const data = await response.json()

      if (!response.ok) {
        alert(data.error || 'Erro ao alterar status da role')
        return
      }

      onRefresh()
    } catch (error) {
      console.error('Error toggling status:', error)
      alert('Erro ao alterar status da role')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex items-center justify-end gap-2">
      {canView && (
        <Tooltip content="Visualizar">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onView(role)}
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
              onClick={() => onEdit(role)}
              className="h-8 w-8"
            >
              <Edit className="h-4 w-4" />
            </Button>
          </Tooltip>
          <Tooltip content={role.ativo ? 'Desativar' : 'Ativar'}>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleToggleStatus}
              disabled={loading}
              className="h-8 w-8"
            >
              <Power className={`h-4 w-4 ${role.ativo ? 'text-red-600' : 'text-green-600'}`} />
            </Button>
          </Tooltip>
        </>
      )}
    </div>
  )
}
