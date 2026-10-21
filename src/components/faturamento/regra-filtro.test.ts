import { describe, expect, it } from 'vitest'
import { ABAS_DE_REGRA, LINHAS_DO_PAINEL, getRuleFilterKey, getRuleFilterLabel } from './regra-filtro'

describe('getRuleFilterKey', () => {
  it('mensalidade de carteira tem aba própria (não cai em Mensalidade nem em Sem regra)', () => {
    expect(getRuleFilterKey({ origemTipo: 'regra_financeira', regraItem: 'mensalidade_carteira', casoRegraCobranca: 'mensalidade_carteira' })).toBe('mensalidade_carteira')
  })

  it('a regra gravada no item vence a regra atual do caso', () => {
    expect(getRuleFilterKey({ origemTipo: 'regra_financeira', regraItem: 'mensalidade_carteira', casoRegraCobranca: 'mensalidade_processo' })).toBe('mensalidade_carteira')
  })

  it('hora lançada em caso de carteira (matriz ou processo) vai para a aba da carteira', () => {
    expect(getRuleFilterKey({ origemTipo: 'timesheet', regraItem: '', casoRegraCobranca: 'mensalidade_carteira' })).toBe('mensalidade_carteira')
    expect(getRuleFilterKey({ origemTipo: 'timesheet', regraItem: 'mensalidade_carteira', casoRegraCobranca: ' Mensalidade_Carteira ' })).toBe('mensalidade_carteira')
  })

  it('mensalidade comum continua em Mensalidade', () => {
    expect(getRuleFilterKey({ origemTipo: 'regra_financeira', regraItem: 'mensal' })).toBe('mensalidade')
    expect(getRuleFilterKey({ origemTipo: 'timesheet', casoRegraCobranca: 'mensal' })).toBe('mensalidade')
  })

  it('demais regras sem mudança', () => {
    expect(getRuleFilterKey({ origemTipo: 'despesa', regraItem: 'mensalidade_carteira' })).toBe('despesa')
    expect(getRuleFilterKey({ origemTipo: 'regra_financeira', regraItem: 'hora_com_cap' })).toBe('hora')
    expect(getRuleFilterKey({ origemTipo: 'regra_financeira', regraItem: 'mensalidade_processo' })).toBe('mensalidade_processo')
    expect(getRuleFilterKey({ origemTipo: 'timesheet', casoRegraCobranca: 'salario_minimo' })).toBe('mensalidade_processo')
    expect(getRuleFilterKey({ origemTipo: 'regra_financeira', regraItem: 'pro_labore' })).toBe('projeto')
    expect(getRuleFilterKey({ origemTipo: 'regra_financeira', regraItem: 'projeto_parcela' })).toBe('projeto_parcelado')
    expect(getRuleFilterKey({ origemTipo: 'regra_financeira', regraItem: 'exito' })).toBe('exito')
    expect(getRuleFilterKey({ origemTipo: 'timesheet', casoRegraCobranca: 'hora' })).toBe('hora')
    expect(getRuleFilterKey({ origemTipo: 'timesheet', casoRegraCobranca: '' })).toBe('outros')
    expect(getRuleFilterKey({ origemTipo: 'regra_financeira', regraItem: 'xyz' })).toBe('outros')
  })
})

describe('abas e painel', () => {
  it('aba "Mensalidade de carteira" logo depois de "Mensalidade"', () => {
    const i = ABAS_DE_REGRA.indexOf('mensalidade')
    expect(ABAS_DE_REGRA[i + 1]).toBe('mensalidade_carteira')
    expect(getRuleFilterLabel('mensalidade_carteira')).toBe('Mensalidade de carteira')
  })

  it('painel tem as mesmas linhas das abas, mais "Sem regra" no fim', () => {
    expect(LINHAS_DO_PAINEL).toEqual([...ABAS_DE_REGRA, 'outros'])
  })
})
