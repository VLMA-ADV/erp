import { describe, expect, it } from 'vitest'
import { isAutoAprovado } from './auto-aprovacao'

describe('isAutoAprovado', () => {
  it('item aprovado pelo sistema mostra o badge', () => {
    expect(isAutoAprovado({ status: 'aprovado', snapshot: { auto_aprovado: true } })).toBe(true)
  })

  it('continua marcado depois de faturado', () => {
    expect(isAutoAprovado({ status: 'faturado', snapshot: { auto_aprovado: true } })).toBe(true)
  })

  it('aprovação humana não mostra o badge', () => {
    expect(isAutoAprovado({ status: 'aprovado', snapshot: {} })).toBe(false)
    expect(isAutoAprovado({ status: 'aprovado', snapshot: null })).toBe(false)
  })

  it('valor alterado depois (marca false) não mostra o badge', () => {
    expect(isAutoAprovado({ status: 'em_revisao', snapshot: { auto_aprovado: false } })).toBe(false)
    expect(isAutoAprovado({ status: 'aprovado', snapshot: { auto_aprovado: false } })).toBe(false)
  })

  it('ignora marca em item que voltou para revisão/aprovação', () => {
    expect(isAutoAprovado({ status: 'em_aprovacao', snapshot: { auto_aprovado: true } })).toBe(false)
    expect(isAutoAprovado({ status: 'em_revisao', snapshot: { auto_aprovado: true } })).toBe(false)
  })

  it('não aceita string "true"', () => {
    expect(isAutoAprovado({ status: 'aprovado', snapshot: { auto_aprovado: 'true' } })).toBe(false)
  })
})
