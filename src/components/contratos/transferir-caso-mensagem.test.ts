import { describe, expect, it } from 'vitest'
import { mensagemTransferenciaCaso } from './transferir-caso-mensagem'

describe('mensagemTransferenciaCaso', () => {
  it('sem retorno: texto simples', () => {
    expect(mensagemTransferenciaCaso(null)).toBe('Caso transferido')
  })

  it('nada a mover', () => {
    expect(mensagemTransferenciaCaso({ itens_movidos: 0, lancamentos_movidos: 0 })).toBe('Caso transferido.')
  })

  it('lista o que foi junto e o que ficou', () => {
    expect(
      mensagemTransferenciaCaso({
        itens_movidos: 14,
        lancamentos_movidos: 17,
        despesas_movidas: 7,
        kits_movidos: 0,
        itens_faturados_mantidos: 4,
      }),
    ).toBe(
      'Caso transferido com 17 lançamentos, 14 itens de faturamento e 7 despesas. 4 itens faturados ficaram no contrato anterior.',
    )
  })

  it('singular', () => {
    expect(
      mensagemTransferenciaCaso({ itens_movidos: 1, lancamentos_movidos: 1, kits_movidos: 1, itens_faturados_mantidos: 1 }),
    ).toBe('Caso transferido com 1 lançamento, 1 item de faturamento e 1 kit aberto. 1 item faturado ficou no contrato anterior.')
  })
})
