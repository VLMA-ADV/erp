'use client'

import { DatePicker } from '@/components/ui/date-picker'
import { Label } from '@/components/ui/label'
import { MoneyInput } from '@/components/ui/money-input'
import { NativeSelect } from '@/components/ui/native-select'

const periodToMonths: Record<string, number> = {
  mensal: 1,
  bimestral: 2,
  trimestral: 3,
  semestral: 6,
  anual: 12,
}

function formatDateToInput(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function buildNextDate(base: string, months: number, dayOfMonth?: number): string {
  if (!base) return ''
  const dt = new Date(base + 'T00:00:00')
  if (Number.isNaN(dt.getTime())) return ''

  const y = dt.getFullYear()
  const m = dt.getMonth()

  const target = new Date(y, m + months, 1)
  const finalDay = Math.min(
    dayOfMonth || dt.getDate(),
    new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate(),
  )
  target.setDate(finalDay)
  return formatDateToInput(target)
}

interface ChoiceOption {
  value: string
  label: string
}

function ChoiceCards({
  value,
  onChange,
  options,
  disabled,
}: {
  value: string
  onChange: (value: string) => void
  options: ChoiceOption[]
  disabled?: boolean
}) {
  return (
    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
      {options.map((option) => {
        const selected = value === option.value
        return (
          <button
            key={option.value}
            type="button"
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={`rounded-md border px-3 py-2 text-left transition ${
              selected ? 'border-primary bg-primary/10 shadow-sm' : 'hover:border-primary/40'
            } ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
          >
            <p className="text-sm font-medium">{option.label}</p>
          </button>
        )
      })}
    </div>
  )
}

export interface CapEncontroSimpleProps {
  regras: Record<string, any>
  onRegraChange: (key: string, value: unknown) => void
  inicioVigencia?: string
  pagamentoDiaMes?: string | number
  isReadOnly?: boolean
  isEdit?: boolean
}

export default function CapEncontroSimple({
  regras,
  onRegraChange,
  inicioVigencia,
  pagamentoDiaMes,
  isReadOnly,
  isEdit,
}: CapEncontroSimpleProps) {
  const capEnabled = Boolean(regras.cap_enabled)
  const capMinEnabled = Boolean(
    regras.cap_min_enabled ??
      regras.cap_limites_enabled ??
      (regras.cap_min !== null && regras.cap_min !== undefined && String(regras.cap_min).trim() !== ''),
  )
  const capMaxEnabled = Boolean(
    regras.cap_max_enabled ??
      regras.cap_limites_enabled ??
      (regras.cap_max !== null && regras.cap_max !== undefined && String(regras.cap_max).trim() !== ''),
  )
  const encontroEnabled = Boolean(regras.encontro_contas_enabled)

  return (
    <div className="space-y-3 md:col-span-2">
      <div className="border-t" />
      <p className="text-base font-semibold">Cap e Encontro de Contas</p>

      <div className="space-y-2">
        <Label>CAP</Label>
        <ChoiceCards
          value={capEnabled ? 'sim' : 'nao'}
          onChange={(value) => {
            const enabled = value === 'sim'
            onRegraChange('cap_enabled', enabled)
            if (!enabled) {
              onRegraChange('cap_limites_enabled', false)
              onRegraChange('cap_min_enabled', false)
              onRegraChange('cap_max_enabled', false)
              onRegraChange('cap_min', '')
              onRegraChange('cap_max', '')
            }
          }}
          disabled={isReadOnly}
          options={[
            { value: 'nao', label: 'Cap desabilitado' },
            { value: 'sim', label: 'Cap habilitado' },
          ]}
        />
      </div>

      {capEnabled && (
        <>
          <div className="space-y-2">
            <Label>Habilitar limites?</Label>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={capMinEnabled}
                  onChange={(e) => {
                    const enabled = e.currentTarget.checked
                    onRegraChange('cap_min_enabled', enabled)
                    onRegraChange('cap_limites_enabled', enabled || capMaxEnabled)
                    if (!enabled) onRegraChange('cap_min', '')
                  }}
                  disabled={isReadOnly}
                  className="h-4 w-4 rounded border-gray-300"
                />
                Ativar limite inferior
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={capMaxEnabled}
                  onChange={(e) => {
                    const enabled = e.currentTarget.checked
                    onRegraChange('cap_max_enabled', enabled)
                    onRegraChange('cap_limites_enabled', capMinEnabled || enabled)
                    if (!enabled) onRegraChange('cap_max', '')
                  }}
                  disabled={isReadOnly}
                  className="h-4 w-4 rounded border-gray-300"
                />
                Ativar limite superior
              </label>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {capMinEnabled ? (
              <div className="space-y-1">
                <Label>Limite inferior</Label>
                <MoneyInput
                  value={regras.cap_min || ''}
                  onValueChange={(value) => onRegraChange('cap_min', value)}
                  disabled={isReadOnly}
                  placeholder="Opcional"
                />
              </div>
            ) : (
              <div />
            )}
            {capMaxEnabled && (
              <div className="space-y-1">
                <Label>Limite superior</Label>
                <MoneyInput
                  value={regras.cap_max || ''}
                  onValueChange={(value) => onRegraChange('cap_max', value)}
                  disabled={isReadOnly}
                  placeholder="Opcional"
                />
              </div>
            )}
          </div>
        </>
      )}

      <div className="space-y-2">
        <Label>Encontro de contas</Label>
        <ChoiceCards
          value={encontroEnabled ? 'sim' : 'nao'}
          onChange={(value) => {
            const enabled = value === 'sim'
            onRegraChange('encontro_contas_enabled', enabled)
            if (!enabled) {
              onRegraChange('encontro_periodicidade', '')
              onRegraChange('data_proximo_encontro', '')
            }
          }}
          disabled={isReadOnly}
          options={[
            { value: 'nao', label: 'Não' },
            { value: 'sim', label: 'Sim' },
          ]}
        />
      </div>

      {encontroEnabled && (
        <>
          <div className="space-y-1">
            <Label>Periodicidade encontro de contas</Label>
            <NativeSelect
              value={regras.encontro_periodicidade || ''}
              onChange={(e) => {
                const periodicidade = e.target.value
                onRegraChange('encontro_periodicidade', periodicidade)

                const months = periodToMonths[periodicidade] || 0
                const baseDate = regras.data_ultimo_encontro || inicioVigencia || ''
                const day = Number(pagamentoDiaMes || '0') || undefined
                const nextDate = months > 0 && baseDate ? buildNextDate(baseDate, months, day) : ''
                onRegraChange('data_proximo_encontro', nextDate)
              }}
              disabled={isReadOnly}
            >
              <option value="">Selecione...</option>
              <option value="mensal">Encontro mensal</option>
              <option value="bimestral">Encontro bimestral</option>
              <option value="trimestral">Encontro trimestral</option>
              <option value="semestral">Encontro semestral</option>
              <option value="anual">Encontro anual</option>
            </NativeSelect>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label>Data último encontro de contas</Label>
              <DatePicker value={regras.data_ultimo_encontro || ''} onChange={() => {}} disabled />
            </div>
            <div className="space-y-1">
              <Label>Data próximo encontro de contas</Label>
              <DatePicker
                value={regras.data_proximo_encontro || ''}
                onChange={(value) => onRegraChange('data_proximo_encontro', value)}
                disabled={isReadOnly || !isEdit}
              />
            </div>
          </div>
        </>
      )}
    </div>
  )
}
