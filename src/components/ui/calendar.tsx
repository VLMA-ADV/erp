'use client'

import { Input } from '@/components/ui/input'

export function Calendar({
  value,
  onChange,
  disabled,
}: {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}) {
  return <Input type="date" value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} />
}
