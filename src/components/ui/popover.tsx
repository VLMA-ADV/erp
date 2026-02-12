'use client'

import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils/cn'

interface PopoverProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  trigger: React.ReactNode
  children: React.ReactNode
  className?: string
}

export function Popover({ open, onOpenChange, trigger, children, className }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onOutside = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onOpenChange(false)
    }
    document.addEventListener('mousedown', onOutside)
    return () => document.removeEventListener('mousedown', onOutside)
  }, [onOpenChange])

  return (
    <div ref={ref} className="relative inline-block">
      <div onClick={() => onOpenChange(!open)}>{trigger}</div>
      {open ? (
        <div className={cn('absolute z-40 mt-2 rounded-md border bg-white p-2 shadow', className)}>
          {children}
        </div>
      ) : null}
    </div>
  )
}
