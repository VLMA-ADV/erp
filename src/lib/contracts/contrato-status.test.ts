import { describe, expect, it } from 'vitest'
import {
  formatContratoStatusLabel,
  normalizeContratoStatusForForm,
  normalizeContratoStatusForToggle,
  normalizeContratoStatusForWrite,
} from './contrato-status'

describe('contrato status normalization', () => {
  it('keeps form state compatible with persisted validacao', () => {
    expect(normalizeContratoStatusForForm('validacao')).toBe('em_analise')
    expect(formatContratoStatusLabel('validacao')).toBe('validação')
  })

  it('maps solicitacao to rascunho before create/update RPCs', () => {
    expect(normalizeContratoStatusForWrite('solicitacao')).toBe('rascunho')
    expect(normalizeContratoStatusForWrite('em_analise')).toBe('validacao')
  })

  it('keeps post-create transition in em_analise for toggle RPC', () => {
    expect(normalizeContratoStatusForToggle('em_analise')).toBe('em_analise')
    expect(normalizeContratoStatusForToggle('validacao')).toBe('em_analise')
  })
})
