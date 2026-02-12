'use client'

import { Button } from '@/components/ui/button'
import { Tooltip } from '@/components/ui/tooltip'
import { Edit } from 'lucide-react'

interface Servico {
  id: string
  nome: string
}

interface ServicosActionsProps {
  servico: Servico
  canEdit: boolean
  onEdit: (servico: Servico) => void
}

export default function ServicosActions({ servico, canEdit, onEdit }: ServicosActionsProps) {
  if (!canEdit) return null

  return (
    <div className="flex items-center justify-end gap-2">
      <Tooltip content="Editar">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onEdit(servico)}
          className="h-8 w-8"
        >
          <Edit className="h-4 w-4" />
        </Button>
      </Tooltip>
    </div>
  )
}
