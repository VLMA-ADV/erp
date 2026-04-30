import { describe, it, expect } from 'vitest'
import { parseCarteiraCsv } from './parse-carteira-csv'

describe('parseCarteiraCsv', () => {
  it('parses comma-separated CSV with header', () => {
    const csv = [
      'numero_processo,identificador',
      '0001234-56.2024.8.26.0100,João da Silva',
      '0007890-12.2024.8.26.0100,Maria Souza',
    ].join('\n')

    const result = parseCarteiraCsv(csv)
    expect(result.validas).toHaveLength(2)
    expect(result.invalidas).toHaveLength(0)
    expect(result.validas[0]).toEqual({
      numero_processo: '0001234-56.2024.8.26.0100',
      identificador: 'João da Silva',
    })
  })

  it('parses semicolon-separated CSV (Excel BR default)', () => {
    const csv = [
      'numero_processo;identificador',
      '0001234-56.2024.8.26.0100;João da Silva',
      '0007890-12.2024.8.26.0100;Maria Souza',
    ].join('\n')

    const result = parseCarteiraCsv(csv)
    expect(result.validas).toHaveLength(2)
    expect(result.validas[1].identificador).toBe('Maria Souza')
  })

  it('strips UTF-8 BOM from header', () => {
    const csv = '﻿numero_processo,identificador\n0001-01,Foo'
    const result = parseCarteiraCsv(csv)
    expect(result.validas).toHaveLength(1)
    expect(result.validas[0].numero_processo).toBe('0001-01')
  })

  it('handles CRLF line endings', () => {
    const csv = 'numero_processo,identificador\r\n0001-01,Foo\r\n0002-02,Bar'
    const result = parseCarteiraCsv(csv)
    expect(result.validas).toHaveLength(2)
    expect(result.validas.map((p) => p.identificador)).toEqual(['Foo', 'Bar'])
  })

  it('skips empty lines silently between valid rows', () => {
    const csv = ['numero_processo,identificador', '0001-01,Foo', '', '0002-02,Bar', ''].join('\n')
    const result = parseCarteiraCsv(csv)
    expect(result.validas).toHaveLength(2)
    expect(result.invalidas).toHaveLength(0)
  })

  it('marks rows without identificador as inválidas', () => {
    const csv = ['numero_processo,identificador', '0001-01,Foo', '0002-02,', '0003-03,Bar'].join('\n')
    const result = parseCarteiraCsv(csv)
    expect(result.validas).toHaveLength(2)
    expect(result.invalidas).toHaveLength(1)
    expect(result.invalidas[0]).toEqual({ linha: 3, motivo: 'sem identificador' })
  })

  it('accepts uppercase header variants', () => {
    const csv = ['NUMERO_PROCESSO;IDENTIFICADOR', '0001-01;Foo'].join('\n')
    const result = parseCarteiraCsv(csv)
    expect(result.validas).toHaveLength(1)
    expect(result.validas[0].identificador).toBe('Foo')
  })

  it('falls back to positional columns when headers are unknown', () => {
    const csv = ['col_a,col_b', '0001-01,Foo', '0002-02,Bar'].join('\n')
    const result = parseCarteiraCsv(csv)
    expect(result.validas).toHaveLength(2)
    expect(result.validas[0].numero_processo).toBe('0001-01')
    expect(result.validas[0].identificador).toBe('Foo')
  })

  it('handles quoted fields with embedded commas', () => {
    const csv = ['numero_processo,identificador', '"0001-01","Silva, João"', '0002-02,Bar'].join('\n')
    const result = parseCarteiraCsv(csv)
    expect(result.validas).toHaveLength(2)
    expect(result.validas[0].identificador).toBe('Silva, João')
  })

  it('returns empty result on empty input', () => {
    expect(parseCarteiraCsv('')).toEqual({ validas: [], invalidas: [] })
    expect(parseCarteiraCsv('\n\n\n')).toEqual({ validas: [], invalidas: [] })
  })
})
