'use client'

import { Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface CategoriaItem {
  id: string
  nome: string
  ativo: boolean
}

export default function CategoriasPrestadoresParceirosActions({
  item,
  canEdit,
  onEdit,
}: {
  item: CategoriaItem
  canEdit: boolean
  onEdit: (item: CategoriaItem) => void
}) {
  if (!canEdit) return null

  return (
    <Button variant="ghost" size="icon" onClick={() => onEdit(item)} aria-label="Editar categoria">
      <Pencil className="h-4 w-4" />
    </Button>
  )
}
