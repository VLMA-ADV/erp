'use client'

import { Button } from '@/components/ui/button'
import { Tooltip } from '@/components/ui/tooltip'
import { Edit } from 'lucide-react'

interface ServicoProduto {
  id: string
  nome: string
}

interface ServicosProdutosActionsProps {
  servicoProduto: ServicoProduto
  canEdit: boolean
  onEdit: (servicoProduto: ServicoProduto) => void
}

export default function ServicosProdutosActions({ servicoProduto, canEdit, onEdit }: ServicosProdutosActionsProps) {
  if (!canEdit) return null

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
    </div>
  )
}
