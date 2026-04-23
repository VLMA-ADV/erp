import { describe, expect, it } from 'vitest'
import {
  clearAllExpansions,
  hasAnyExpansion,
  type ExpansionState,
} from './itens-a-faturar-expansions'

describe('clearAllExpansions', () => {
  it('retorna os 3 records vazios', () => {
    expect(clearAllExpansions()).toEqual({
      expandedClientes: {},
      expandedContratos: {},
      expandedCasos: {},
    })
  })

  it('não inclui campos de filtros no retorno (search, datas, regraTab, selectedCasos)', () => {
    const result = clearAllExpansions() as Record<string, unknown>
    const allowedKeys = ['expandedClientes', 'expandedContratos', 'expandedCasos']
    expect(Object.keys(result).sort()).toEqual(allowedKeys.sort())
    for (const forbidden of ['search', 'dateStart', 'dateEnd', 'regraTab', 'selectedCasos']) {
      expect(forbidden in result).toBe(false)
    }
  })

  it('produz referências novas a cada chamada (seguro para setState)', () => {
    const a = clearAllExpansions()
    const b = clearAllExpansions()
    expect(a.expandedClientes).not.toBe(b.expandedClientes)
    expect(a.expandedContratos).not.toBe(b.expandedContratos)
    expect(a.expandedCasos).not.toBe(b.expandedCasos)
  })
})

describe('hasAnyExpansion', () => {
  const empty: ExpansionState = clearAllExpansions()

  it('retorna false quando todos os records estão vazios', () => {
    expect(hasAnyExpansion(empty)).toBe(false)
  })

  it('retorna false quando records têm chaves mas todas são false', () => {
    expect(
      hasAnyExpansion({
        expandedClientes: { c1: false, c2: false },
        expandedContratos: { k1: false },
        expandedCasos: {},
      }),
    ).toBe(false)
  })

  it('retorna true quando qualquer cliente está expandido', () => {
    expect(
      hasAnyExpansion({ ...empty, expandedClientes: { c1: true } }),
    ).toBe(true)
  })

  it('retorna true quando qualquer contrato está expandido', () => {
    expect(
      hasAnyExpansion({ ...empty, expandedContratos: { k1: true } }),
    ).toBe(true)
  })

  it('retorna true quando qualquer caso está expandido', () => {
    expect(
      hasAnyExpansion({ ...empty, expandedCasos: { c1: true } }),
    ).toBe(true)
  })
})
