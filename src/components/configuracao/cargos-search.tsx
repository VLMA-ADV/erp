'use client'

import { useState, useEffect, useRef } from 'react'
import { Input } from '@/components/ui/input'

interface CargosSearchProps {
  onSearch: (value: string) => void
}

export default function CargosSearch({ onSearch }: CargosSearchProps) {
  const [searchValue, setSearchValue] = useState('')
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    // Limpar timer anterior se existir
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
    }

    // Criar novo timer com debounce de 300ms
    debounceTimerRef.current = setTimeout(() => {
      onSearch(searchValue)
    }, 300)

    // Cleanup: limpar timer quando componente desmontar ou valor mudar
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
    }
  }, [searchValue, onSearch])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setSearchValue(value)
  }

  return (
    <div className="w-full max-w-md">
      <Input
        type="text"
        placeholder="Buscar por nome ou código..."
        value={searchValue}
        onChange={handleChange}
      />
    </div>
  )
}
