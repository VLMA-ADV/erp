'use client'

// Régua de 5 faixas do PDI — cor e seletor compartilhados pelas telas de metas.

export interface FaixaOpcao { codigo: string; rotulo: string }

export function faixaColor(codigo: string | null, active: boolean): string {
  const base = active ? 'text-white' : 'bg-card text-ink-secondary'
  if (!active) return 'border-hairline ' + base
  switch (codigo) {
    case 'baixa_performance': return 'bg-red-600 border-red-600 ' + base
    case 'a_melhorar': return 'bg-amber-500 border-amber-500 ' + base
    case 'dentro_da_media': return 'bg-ink border-ink ' + base
    case 'acima_do_esperado': return 'bg-primary border-primary text-primary-foreground'
    case 'fora_da_curva': return 'bg-emerald-600 border-emerald-600 ' + base
    default: return 'bg-ink border-ink ' + base
  }
}

export const FAIXA_HEX: Record<string, string> = {
  baixa_performance: '#dc2626',
  a_melhorar: '#f59e0b',
  dentro_da_media: '#1E1423',
  acima_do_esperado: '#FF9900',
  fora_da_curva: '#059669',
}

export function FaixaPicker({
  regua,
  value,
  onChange,
  disabled = false,
  ariaLabel,
}: {
  regua: FaixaOpcao[]
  value: string | null
  onChange?: (v: string) => void
  disabled?: boolean
  ariaLabel?: string
}) {
  return (
    <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={ariaLabel} aria-disabled={disabled || undefined}>
      {regua.map((f) => (
        <button
          key={f.codigo}
          type="button"
          role="radio"
          aria-checked={value === f.codigo}
          disabled={disabled}
          onClick={() => onChange?.(f.codigo)}
          className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${faixaColor(f.codigo, value === f.codigo)} ${disabled ? 'cursor-not-allowed opacity-60' : 'hover:border-primary'}`}
        >
          {f.rotulo}
        </button>
      ))}
    </div>
  )
}

export function FaixaBadge({ regua, codigo }: { regua: FaixaOpcao[]; codigo: string | null }) {
  if (!codigo) return <span className="text-xs text-ink-mute">—</span>
  const f = regua.find((r) => r.codigo === codigo)
  return <span className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-medium ${faixaColor(codigo, true)}`}>{f?.rotulo || codigo}</span>
}

export function progressoHex(p: number): string {
  if (p < 30) return '#dc2626'
  if (p < 60) return '#f59e0b'
  if (p < 80) return '#84cc16'
  return '#059669'
}

export function BarraProgresso({ valor, className = '' }: { valor: number; className?: string }) {
  const v = Math.max(0, Math.min(100, valor))
  return (
    <div className={`h-2 overflow-hidden rounded-full bg-secondary ${className}`} role="progressbar" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full transition-all" style={{ width: `${v}%`, background: progressoHex(v) }} />
    </div>
  )
}
