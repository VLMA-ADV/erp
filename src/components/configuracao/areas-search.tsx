'use client'

import { useState, useEffect, useRef } from 'react'
import { Input } from '@/components/ui/input'

interface AreasSearchProps {
  onSearch: (value: string) => void
}

export default function AreasSearch({ onSearch }: AreasSearchProps) {
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

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchValue(e.target.value)
  }

  return (
    <div className="w-full max-w-md">
      <Input
        type="text"
        placeholder="Buscar centro de custo por nome ou código..."
        value={searchValue}
        onChange={handleChange}
      />
    </div>
  )
}
