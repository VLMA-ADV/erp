'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronsUpDown } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'

export interface CommandSelectOption {
  value: string
  label: string
  group?: string
}

interface CommandSelectProps {
  value: string
  onValueChange: (value: string) => void
  options: CommandSelectOption[]
  placeholder?: string
  searchPlaceholder?: string
  emptyText?: string
  disabled?: boolean
  onCreateOption?: (label: string) => void
  createOptionLabel?: string
}

export function CommandSelect({
  value,
  onValueChange,
  options,
  placeholder = 'Selecione...',
  searchPlaceholder = 'Buscar...',
  emptyText = 'Nenhum resultado.',
  disabled,
  onCreateOption,
  createOptionLabel = 'Cadastrar',
}: CommandSelectProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [panelWidth, setPanelWidth] = useState<number>(360)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onOutsideClick = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onOutsideClick)
    return () => document.removeEventListener('mousedown', onOutsideClick)
  }, [])

  useEffect(() => {
    if (!open) return
    const triggerWidth = containerRef.current?.getBoundingClientRect().width ?? 0
    setPanelWidth(Math.max(Math.round(triggerWidth), 360))
  }, [open])

  const selected = useMemo(() => options.find((o) => o.value === value), [options, value])

  const filteredOptions = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return options
    return options.filter((option) => option.label.toLowerCase().includes(normalized))
  }, [options, query])

  const groupedOptions = useMemo(() => {
    const map = new Map<string, CommandSelectOption[]>()
    for (const option of filteredOptions) {
      const groupName = option.group || ''
      const current = map.get(groupName) || []
      current.push(option)
      map.set(groupName, current)
    }
    return Array.from(map.entries()).sort(([groupA], [groupB]) => {
      if (!groupA && !groupB) return 0
      if (!groupA) return -1
      if (!groupB) return 1
      return groupA.localeCompare(groupB, 'pt-BR')
    })
  }, [filteredOptions])

  const canCreateOption = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!onCreateOption || !normalized) return false
    return !options.some((option) => option.label.trim().toLowerCase() === normalized)
  }, [onCreateOption, options, query])

  return (
    <div ref={containerRef} className="relative w-full min-w-0">
      <Button
        type="button"
        variant="outline"
        role="combobox"
        aria-expanded={open}
        className="h-10 w-full min-w-0 max-w-full justify-between overflow-hidden font-normal"
        onClick={() => !disabled && setOpen((prev) => !prev)}
        disabled={disabled}
      >
        <span className="block min-w-0 truncate text-left">{selected?.label || placeholder}</span>
        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
      </Button>

      {open && (
        <div
          className="absolute left-0 z-[80] mt-1 max-w-[calc(100vw-2rem)] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md"
          style={{ width: panelWidth }}
        >
          <Command>
            <CommandInput
              placeholder={searchPlaceholder}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <CommandList className="max-h-72 overflow-y-auto overflow-x-hidden">
              {groupedOptions.length === 0 ? <CommandEmpty>{emptyText}</CommandEmpty> : null}
              {groupedOptions.map(([groupName, groupOptions]) => (
                <CommandGroup key={groupName || '__default__'}>
                  {groupName ? <div className="px-2 py-1 text-xs font-medium text-muted-foreground">{groupName}</div> : null}
                  {groupOptions.map((option) => (
                    <CommandItem
                      key={option.value}
                      className="max-w-full truncate"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        onValueChange(option.value)
                        setOpen(false)
                        setQuery('')
                      }}
                    >
                      <Check className={cn('mr-2 h-4 w-4', value === option.value ? 'opacity-100' : 'opacity-0')} />
                      {option.label}
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
              {canCreateOption ? (
                <CommandGroup>
                  <CommandItem
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      onCreateOption?.(query.trim())
                      setOpen(false)
                      setQuery('')
                    }}
                  >
                    <span className="font-medium">{createOptionLabel}</span>
                    <span className="ml-1 truncate">"{query.trim()}"</span>
                  </CommandItem>
                </CommandGroup>
              ) : null}
            </CommandList>
          </Command>
        </div>
      )}
    </div>
  )
}
