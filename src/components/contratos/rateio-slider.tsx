'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CommandSelect } from '@/components/ui/command-select'

interface OptionItem {
  value: string
  label: string
}

export interface RateioItem {
  id: string
  percentual?: number | null
}

type NormalizedItem = { id: string; percentual: number }

function clamp2(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value * 100) / 100))
}

function parseInputPercent(raw: string): number | null {
  const trimmed = raw.replace(',', '.').trim()
  if (trimmed === '') return null
  const n = Number(trimmed)
  if (!Number.isFinite(n)) return null
  return clamp2(n)
}

function formatPercent(value: number): string {
  const rounded = Math.round(value * 100) / 100
  if (Number.isInteger(rounded)) return String(rounded)
  return rounded.toString().replace('.', ',')
}

function distributeEvenly(items: Array<{ id: string }>): NormalizedItem[] {
  if (!items.length) return []
  const n = items.length
  const base = Math.floor(10000 / n) / 100
  const baseTotal = Math.round(base * n * 100) / 100
  const remainder = Math.round((100 - baseTotal) * 100) / 100
  return items.map((item, idx) => ({
    id: item.id,
    percentual: clamp2(idx === n - 1 ? base + remainder : base),
  }))
}

export default function RateioSlider({
  title,
  options,
  items,
  onChange,
  disabled,
  frameless = false,
}: {
  title: string
  options: OptionItem[]
  items: RateioItem[]
  onChange: (items: NormalizedItem[]) => void
  disabled?: boolean
  frameless?: boolean
}) {
  const [newItemId, setNewItemId] = useState('')
  const [drafts, setDrafts] = useState<Record<string, string>>({})

  const normalized: NormalizedItem[] = items.map((i) => ({
    id: i.id,
    percentual: clamp2(Number(i.percentual) || 0),
  }))

  const total = normalized.reduce((acc, item) => acc + item.percentual, 0)
  const totalRounded = Math.round(total * 100) / 100
  const overLimit = totalRounded > 100 + 0.001
  const atLimit = Math.abs(totalRounded - 100) < 0.01

  const itemLabel = (id: string) => options.find((o) => o.value === id)?.label || id
  const availableToAdd = options.filter((o) => !normalized.some((i) => i.id === o.value))

  const addItem = () => {
    if (!newItemId) return
    if (normalized.some((i) => i.id === newItemId)) return
    const next = [...normalized, { id: newItemId, percentual: 0 }]
    if (total < 0.01) {
      onChange(distributeEvenly(next))
    } else {
      onChange(next)
    }
    setNewItemId('')
  }

  const removeItem = (id: string) => {
    onChange(normalized.filter((item) => item.id !== id))
    setDrafts((prev) => {
      if (prev[id] === undefined) return prev
      const { [id]: _removed, ...rest } = prev
      return rest
    })
  }

  const handleInputChange = (id: string, value: string) => {
    setDrafts((prev) => ({ ...prev, [id]: value }))
  }

  const commitInput = (id: string) => {
    const raw = drafts[id]
    if (raw === undefined) return
    const parsed = parseInputPercent(raw)
    onChange(
      normalized.map((item) =>
        item.id === id ? { ...item, percentual: parsed ?? 0 } : item
      )
    )
    setDrafts((prev) => {
      const { [id]: _removed, ...rest } = prev
      return rest
    })
  }

  const inputValueFor = (id: string, current: number): string => {
    if (drafts[id] !== undefined) return drafts[id]
    return formatPercent(current)
  }

  const totalColor = overLimit
    ? 'text-red-700'
    : atLimit
      ? 'text-green-700'
      : 'text-amber-700'

  return (
    <div className={frameless ? 'space-y-2' : 'space-y-2 rounded-md border p-3'}>
      <div className="flex items-center justify-between">
        <LabelText>{title}</LabelText>
        <span className={`text-xs font-medium ${totalColor}`}>
          Total: {formatPercent(totalRounded)}%
          {overLimit ? ' — excede 100%' : ''}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_auto]">
        <CommandSelect
          value={newItemId}
          onValueChange={(value) => setNewItemId(value)}
          options={availableToAdd}
          placeholder="Selecione para adicionar..."
          searchPlaceholder="Buscar..."
          emptyText="Nenhuma opção encontrada."
          disabled={disabled}
        />
        <Button type="button" variant="outline" onClick={addItem} disabled={disabled || !newItemId}>
          Adicionar
        </Button>
      </div>

      {normalized.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum item adicionado.</p>
      ) : (
        <>
          <div
            className="relative h-12 overflow-hidden rounded-md border bg-muted/30"
            aria-label="Visualização da divisão"
          >
            <div className="flex h-full w-full">
              {normalized.map((item) => (
                <div
                  key={item.id}
                  className="flex h-full items-center justify-center border-r border-white/60 bg-primary/25 px-2 text-xs font-medium"
                  style={{ width: `${Math.min(item.percentual, 100)}%` }}
                  title={`${itemLabel(item.id)} - ${formatPercent(item.percentual)}%`}
                >
                  <span className="truncate">
                    {itemLabel(item.id)} ({formatPercent(item.percentual)}%)
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-1">
            {normalized.map((item) => (
              <div key={item.id} className="flex items-center gap-2 rounded border px-2 py-1 text-sm">
                <span className="flex-1 truncate">{itemLabel(item.id)}</span>
                <div className="flex items-center gap-1">
                  <Input
                    type="text"
                    inputMode="decimal"
                    value={inputValueFor(item.id, item.percentual)}
                    onChange={(e) => handleInputChange(item.id, e.target.value)}
                    onBlur={() => commitInput(item.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        commitInput(item.id)
                        e.currentTarget.blur()
                      }
                    }}
                    className="h-8 w-20 text-right"
                    disabled={disabled}
                    aria-label={`Percentual de ${itemLabel(item.id)}`}
                  />
                  <span className="text-xs text-muted-foreground">%</span>
                  {!disabled && (
                    <Button type="button" variant="ghost" size="sm" onClick={() => removeItem(item.id)}>
                      Remover
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function LabelText({ children }: { children: React.ReactNode }) {
  return <p className="text-sm font-medium">{children}</p>
}
