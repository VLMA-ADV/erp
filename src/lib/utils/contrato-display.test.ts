import { describe, expect, it } from 'vitest'
import { formatContratoDisplay } from './contrato-display'

describe('formatContratoDisplay (Item 5)', () => {
  it('CA-1: contrato com numero_sequencial + nome_contrato distinto → primary "Contrato N", secondary nome_contrato', () => {
    const result = formatContratoDisplay(25, 'Tijuca-2024')
    expect(result.primary).toBe('Contrato 25')
    expect(result.secondary).toBe('Tijuca-2024')
    expect(result.full).toBe('Contrato 25 — Tijuca-2024')
  })

  it('CA-2: contrato com numero_sequencial + nome_contrato == "Contrato N" (backfill RF-064) → secondary suprimido', () => {
    const result = formatContratoDisplay(25, 'Contrato 25')
    expect(result.primary).toBe('Contrato 25')
    expect(result.secondary).toBeNull()
    expect(result.full).toBe('Contrato 25')
  })

  it('CA-3: contrato sem numero_sequencial mas com nome_contrato → fallback pra nome_contrato', () => {
    const result = formatContratoDisplay(null, 'Tijuca-2024')
    expect(result.primary).toBe('Tijuca-2024')
    expect(result.secondary).toBeNull()
    expect(result.full).toBe('Tijuca-2024')
  })

  it('CA-4: contrato sem numero_sequencial e sem nome_contrato → fallback default', () => {
    const result = formatContratoDisplay(null, null)
    expect(result.primary).toBe('Contrato sem identificador')
    expect(result.secondary).toBeNull()
    expect(result.full).toBe('Contrato sem identificador')
  })

  it('CA-5: fallback customizado via options', () => {
    const result = formatContratoDisplay(undefined, '', { fallback: 'Será gerado ao salvar' })
    expect(result.primary).toBe('Será gerado ao salvar')
    expect(result.full).toBe('Será gerado ao salvar')
  })

  it('CA-6: suppressSecondary (uso em breadcrumb) força secondary=null mesmo quando nome_contrato distinto', () => {
    const result = formatContratoDisplay(25, 'Tijuca-2024', { suppressSecondary: true })
    expect(result.primary).toBe('Contrato 25')
    expect(result.secondary).toBeNull()
    expect(result.full).toBe('Contrato 25')
  })

  it('CA-7: numero_sequencial não-positivo é tratado como ausente', () => {
    expect(formatContratoDisplay(0, 'Caso X').primary).toBe('Caso X')
    expect(formatContratoDisplay(-1, 'Caso X').primary).toBe('Caso X')
    expect(formatContratoDisplay(NaN, 'Caso X').primary).toBe('Caso X')
  })

  it('CA-8: nome_contrato com whitespace só conta como vazio', () => {
    const result = formatContratoDisplay(25, '   ')
    expect(result.primary).toBe('Contrato 25')
    expect(result.secondary).toBeNull()
  })

  it('CA-9: undefined em ambos params usa fallback', () => {
    const result = formatContratoDisplay(undefined, undefined)
    expect(result.primary).toBe('Contrato sem identificador')
  })
})
