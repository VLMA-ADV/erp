import { describe, expect, it } from 'vitest'
import { erroValorHoraCarteira, normalizarValorHoraCarteira, valorHoraCarteiraNumero } from './valor-hora-carteira'

describe('valor da hora da carteira', () => {
  it('vazio, zero e inválido = sem valor de hora (comportamento de hoje)', () => {
    for (const v of [null, undefined, '', '  ', '0.00', '0', 'abc', -5]) {
      expect(normalizarValorHoraCarteira(v)).toBeNull()
    }
  })

  it('grava com ponto e duas casas', () => {
    expect(normalizarValorHoraCarteira('350')).toBe('350.00')
    expect(normalizarValorHoraCarteira('350,5')).toBe('350.50')
    expect(valorHoraCarteiraNumero('0.03')).toBe(0.03)
  })

  it('validação: só recusa negativo e texto que não é número', () => {
    expect(erroValorHoraCarteira('')).toBeNull()
    expect(erroValorHoraCarteira('0.00')).toBeNull()
    expect(erroValorHoraCarteira('350.00')).toBeNull()
    expect(erroValorHoraCarteira('-1')).toMatch(/maior que zero/)
    expect(erroValorHoraCarteira('abc')).toMatch(/inválido/)
  })
})
