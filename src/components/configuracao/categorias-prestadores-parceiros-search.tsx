'use client'

import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'

export default function CategoriasPrestadoresParceirosSearch({
  onSearch,
}: {
  onSearch: (value: string) => void
}) {
  return (
    <div className="relative w-full max-w-md">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
      <Input
        placeholder="Buscar categoria por nome..."
        className="pl-9"
        onChange={(e) => onSearch(e.target.value)}
      />
    </div>
  )
}
