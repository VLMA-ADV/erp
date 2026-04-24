'use client'

import { Input } from '@/components/ui/input'

interface MoneyInputProps {
  value: string
  onValueChange: (value: string) => void
  disabled?: boolean
  placeholder?: string
  readOnly?: boolean
}

function toDigits(value: string) {
  return (value || '').replace(/\D/g, '')
}

function digitsToDecimalString(digits: string) {
  const normalized = digits || '0'
  const cents = Number(normalized)
  return (cents / 100).toFixed(2)
}

function decimalToDigits(value: string) {
  if (!value) return '0'
  const numeric = Number(String(value).replace(',', '.'))
  if (!Number.isFinite(numeric) || numeric < 0) return '0'
  return String(Math.round(numeric * 100))
}

function formatCurrencyDisplay(value: string) {
  const digits = decimalToDigits(value)
  const decimal = Number(digitsToDecimalString(digits))
  return decimal.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

export function MoneyInput({
  value,
  onValueChange,
  disabled,
  placeholder = '0,00',
  readOnly,
}: MoneyInputProps) {
  return (
    <Input
      value={formatCurrencyDisplay(value)}
      onChange={(e) => {
        const digits = toDigits(e.target.value)
        onValueChange(digitsToDecimalString(digits))
      }}
      inputMode="numeric"
      disabled={disabled}
      readOnly={readOnly}
      placeholder={placeholder}
    />
  )
}

