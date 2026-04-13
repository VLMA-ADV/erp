import { describe, expect, it } from 'vitest'
import { normalizeDocumento, parseClientesCsv } from './clientes-csv'

describe('parseClientesCsv', () => {
  it('parseia linhas válidas e ignora colunas extras', () => {
    const input = [
      'nome,cnpj,email',
      '"ACME Ltda","12.345.678/0001-90",financeiro@acme.com',
      'Beta SA,98.765.432/0001-10,contato@beta.com',
    ].join('\n')

    expect(parseClientesCsv(input)).toEqual({
      rows: [
        { nome: 'ACME Ltda', cnpj: '12345678000190' },
        { nome: 'Beta SA', cnpj: '98765432000110' },
      ],
      errors: [],
    })
  })

  it('retorna erros quando faltam colunas obrigatórias', () => {
    const input = ['empresa,email', 'ACME,financeiro@acme.com'].join('\n')

    expect(parseClientesCsv(input).errors).toContain('Cabeçalho inválido. Use pelo menos as colunas "nome" e "cnpj".')
  })

  it('retorna erros por linha quando nome ou documento faltam', () => {
    const input = ['nome,cnpj', 'ACME,', ',12.345.678/0001-90'].join('\n')

    expect(parseClientesCsv(input)).toEqual({
      rows: [],
      errors: [
        'Linha 2: nome e CNPJ são obrigatórios.',
        'Linha 3: nome e CNPJ são obrigatórios.',
      ],
    })
  })
})

describe('normalizeDocumento', () => {
  it('remove caracteres não numéricos', () => {
    expect(normalizeDocumento('12.345.678/0001-90')).toBe('12345678000190')
  })
})
