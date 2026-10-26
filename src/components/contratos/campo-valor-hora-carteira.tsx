'use client'

import { Label } from '@/components/ui/label'
import { MoneyInput } from '@/components/ui/money-input'
import { normalizarValorHoraCarteira, valorHoraCarteiraNumero } from '@/lib/contracts/valor-hora-carteira'

const fmt = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/**
 * "Valor da hora" da mensalidade de carteira (só na matriz). Preenchido, as
 * horas de todos os casos da carteira são cobradas por ele e somam com a
 * mensalidade; vazio, a hora da carteira sai a R$ 0,00, como sempre.
 */
export function CampoValorHoraCarteira({
  value,
  valorMensal,
  onChange,
  disabled,
}: {
  value: unknown
  valorMensal: unknown
  onChange: (value: string | null) => void
  disabled?: boolean
}) {
  const hora = valorHoraCarteiraNumero(value)
  const mensal = valorHoraCarteiraNumero(valorMensal)
  return (
    <div className="max-w-sm space-y-2" data-testid="campo-valor-hora-carteira">
      <Label>Valor da hora</Label>
      <MoneyInput
        value={hora !== null ? hora.toFixed(2) : ''}
        onValueChange={(v) => onChange(normalizarValorHoraCarteira(v))}
        disabled={disabled}
      />
      <p className="text-xs text-muted-foreground">
        {hora !== null
          ? `Todas as horas da carteira (este caso e os processos dela) são cobradas a R$ ${fmt(hora)}/h e somam com a mensalidade${mensal !== null ? ` de R$ ${fmt(mensal)}` : ''}.`
          : 'Vazio: as horas da carteira não são cobradas (R$ 0,00), só a mensalidade.'}
      </p>
    </div>
  )
}
