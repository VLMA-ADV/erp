'use client'

import { useState } from 'react'
import { Popover } from '@/components/ui/popover'

interface DropdownMenuItem {
  label: string
  onSelect: () => void
}

export function DropdownMenu({
  trigger,
  items,
}: {
  trigger: React.ReactNode
  items: DropdownMenuItem[]
}) {
  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen} trigger={trigger} className="min-w-44 p-1">
      <div className="space-y-1">
        {items.map((item) => (
          <button
            key={item.label}
            className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
            onClick={() => {
              item.onSelect()
              setOpen(false)
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
    </Popover>
  )
}
