import { describe, expect, it } from 'vitest'
import { TEXTO_FRACAO, ehFracaoValida, validarDuracao } from './duracao'

describe('ehFracaoValida', () => {
  it('aceita múltiplos de 5', () => {
    for (const m of [5, 10, 15, 55, 60, 125]) expect(ehFracaoValida(m)).toBe(true)
  })
  it('recusa o que não fecha em 5', () => {
    for (const m of [1, 4, 12, 59, 61, 7.5]) expect(ehFracaoValida(m)).toBe(false)
  })
})

describe('validarDuracao — lançamento novo', () => {
  it('aceita 5, 15 e 2h05', () => {
    expect(validarDuracao(5)).toEqual({ ok: true })
    expect(validarDuracao(15)).toEqual({ ok: true })
    expect(validarDuracao(125)).toEqual({ ok: true })
  })
  it('recusa 12 min com a mensagem da fração', () => {
    const r = validarDuracao(12)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.mensagem).toContain('12 min')
      expect(r.mensagem).toContain(TEXTO_FRACAO)
    }
  })
  it('recusa zero e valores inválidos', () => {
    expect(validarDuracao(0).ok).toBe(false)
    expect(validarDuracao(-5).ok).toBe(false)
    expect(validarDuracao(Number.NaN).ok).toBe(false)
  })
})

describe('validarDuracao — edição de lançamento antigo', () => {
  it('mantém 12 min se a duração não mudou', () => {
    expect(validarDuracao(12, 12)).toEqual({ ok: true })
  })
  it('recusa trocar 12 por 13', () => {
    expect(validarDuracao(13, 12).ok).toBe(false)
  })
  it('aceita trocar 12 por 15', () => {
    expect(validarDuracao(15, 12)).toEqual({ ok: true })
  })
  it('um lançamento antigo com 0 continua exigindo duração', () => {
    expect(validarDuracao(0, 0).ok).toBe(false)
  })
})
