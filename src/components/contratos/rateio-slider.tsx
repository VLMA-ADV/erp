'use client'

import { useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { CommandSelect } from '@/components/ui/command-select'

interface OptionItem {
  value: string
  label: string
}

export interface RateioItem {
  id: string
  percentual?: number | null
}

function normalizePercentuais(items: RateioItem[]): Array<{ id: string; percentual: number }> {
  if (!items.length) return []
  const n = items.length
  const base = Math.floor(100 / n)
  const remainder = 100 - base * n
  const next = items.map((item, idx) => ({
    id: item.id,
    percentual: base + (idx >= n - remainder ? 1 : 0),
  }))
  return next
}

function safePercent(item: RateioItem) {
  return Math.max(0, Math.min(100, Number(item.percentual) || 0))
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
  onChange: (items: Array<{ id: string; percentual: number }>) => void
  disabled?: boolean
  frameless?: boolean
}) {
  const [newItemId, setNewItemId] = useState('')
  const trackRef = useRef<HTMLDivElement>(null)

  const normalized = useMemo(() => {
    const sum = items.reduce((acc, item) => acc + safePercent(item), 0)
    if (sum !== 100 && items.length > 0) return normalizePercentuais(items)
    return items.map((i) => ({ id: i.id, percentual: safePercent(i) }))
  }, [items])

  const total = normalized.reduce((acc, item) => acc + item.percentual, 0)

  const itemLabel = (id: string) => options.find((o) => o.value === id)?.label || id

  const addItem = () => {
    if (!newItemId) return
    if (normalized.some((i) => i.id === newItemId)) return
    onChange(normalizePercentuais([...normalized, { id: newItemId, percentual: 0 }]))
    setNewItemId('')
  }

  const removeItem = (id: string) => {
    const next = normalized.filter((item) => item.id !== id)
    onChange(next.length ? normalizePercentuais(next) : [])
  }

  const startDragBoundary = (boundaryIndex: number, e: React.MouseEvent) => {
    if (disabled || !trackRef.current || normalized.length < 2) return
    e.preventDefault()

    const current = [...normalized]
    const leftIndex = boundaryIndex
    const rightIndex = boundaryIndex + 1
    const leftRightTotal = current[leftIndex].percentual + current[rightIndex].percentual
    const prefixBefore = current.slice(0, leftIndex).reduce((acc, item) => acc + item.percentual, 0)
    const rect = trackRef.current.getBoundingClientRect()

    const onMove = (ev: MouseEvent) => {
      const x = Math.max(0, Math.min(rect.width, ev.clientX - rect.left))
      const boundaryPct = Math.round((x / rect.width) * 100)
      const newLeft = Math.max(1, Math.min(leftRightTotal - 1, boundaryPct - prefixBefore))
      const newRight = leftRightTotal - newLeft
      const next = [...current]
      next[leftIndex] = { ...next[leftIndex], percentual: newLeft }
      next[rightIndex] = { ...next[rightIndex], percentual: newRight }
      onChange(next)
    }

    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const availableToAdd = options.filter((o) => !normalized.some((i) => i.id === o.value))

  return (
    <div className={frameless ? 'space-y-2' : 'space-y-2 rounded-md border p-3'}>
      <div className="flex items-center justify-between">
        <LabelText>{title}</LabelText>
        <span className={`text-xs font-medium ${total === 100 ? 'text-green-700' : 'text-amber-700'}`}>
          Total: {total}%
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
          <div ref={trackRef} className="relative h-12 overflow-hidden rounded-md border bg-muted/30">
            <div className="flex h-full w-full">
              {normalized.map((item) => (
                <div
                  key={item.id}
                  className="flex h-full items-center justify-center border-r border-white/60 bg-primary/25 px-2 text-xs font-medium"
                  style={{ width: `${item.percentual}%` }}
                  title={`${itemLabel(item.id)} - ${item.percentual}%`}
                >
                  <span className="truncate">
                    {itemLabel(item.id)} ({item.percentual}%)
                  </span>
                </div>
              ))}
            </div>

            {!disabled &&
              normalized.length > 1 &&
              normalized.slice(0, -1).map((_, idx) => {
                const left = normalized.slice(0, idx + 1).reduce((acc, item) => acc + item.percentual, 0)
                return (
                  <button
                    key={idx}
                    type="button"
                    className="absolute top-0 h-full w-2 -translate-x-1/2 cursor-col-resize bg-primary/70"
                    style={{ left: `${left}%` }}
                    onMouseDown={(e) => startDragBoundary(idx, e)}
                    aria-label={`Ajustar divisão ${idx + 1}`}
                  />
                )
              })}
          </div>

          <div className="space-y-1">
            {normalized.map((item) => (
              <div key={item.id} className="flex items-center justify-between rounded border px-2 py-1 text-sm">
                <span className="truncate">{itemLabel(item.id)}</span>
                <div className="flex items-center gap-2">
                  <span className="font-medium">{item.percentual}%</span>
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
