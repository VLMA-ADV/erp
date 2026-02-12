'use client'

import { Calendar } from '@/components/ui/calendar'

interface DatePickerProps {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}

export function DatePicker({ value, onChange, disabled }: DatePickerProps) {
  return <Calendar value={value} onChange={onChange} disabled={disabled} />
}
