'use client'

import { useState, useEffect, useRef } from 'react'
import { Input } from '@/components/ui/input'

interface GruposEconomicosSearchProps {
  onSearch: (value: string) => void
}

export default function GruposEconomicosSearch({ onSearch }: GruposEconomicosSearchProps) {
  const [searchValue, setSearchValue] = useState('')
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
    }

    debounceTimerRef.current = setTimeout(() => {
      onSearch(searchValue)
    }, 300)

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
    }
  }, [searchValue, onSearch])

  return (
    <div className="w-full max-w-md">
      <Input
        type="text"
        placeholder="Buscar por nome..."
        value={searchValue}
        onChange={(e) => setSearchValue(e.target.value)}
      />
    </div>
  )
}
