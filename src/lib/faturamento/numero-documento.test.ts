import { describe, expect, it } from 'vitest'
import { kitTemNumeroDocumento, numeroDocumentoDaBusca, numerosDocumentoDoKit } from './numero-documento'
import { montarDocumento, tituloComNumero } from '@/lib/utils/documento-vlma'

describe('numeroDocumentoDaBusca', () => {
  it.each([
    ['15', 15],
    ['nº 15', 15],
    ['Nº15', 15],
    ['n. 15', 15],
    ['no 15', 15],
    ['#15', 15],
    ['doc 15', 15],
    ['Documento nº 15', 15],
    ['  16  ', 16],
  ])('%s → %s', (termo, esperado) => {
    expect(numeroDocumentoDaBusca(termo)).toBe(esperado)
  })

  it.each(['', 'Fulano', '15 abc', 'caso 15', '0', null, undefined])('%s não é número de documento', (termo) => {
    expect(numeroDocumentoDaBusca(termo as string)).toBeNull()
  })
})

describe('numerosDocumentoDoKit', () => {
  const kit = {
    documentos: {
      nfse: { numero_documento: 7 },
      nfses: [{ numero_documento: 7 }, { numero_documento: 8 }, { numero_documento: null }],
      relatorio_timesheet: { numero_documento: 15 },
      nota_debito: null,
    },
  }

  it('junta NFS-e de cada pagador, relatório e ND, sem repetir', () => {
    expect(numerosDocumentoDoKit(kit)).toEqual([7, 8, 15])
  })

  it('acha o kit pelo número, só com número exato', () => {
    expect(kitTemNumeroDocumento(kit, 'nº 8')).toBe(true)
    expect(kitTemNumeroDocumento(kit, '15')).toBe(true)
    expect(kitTemNumeroDocumento(kit, '1')).toBe(false)
    expect(kitTemNumeroDocumento(kit, 'cliente')).toBe(false)
  })

  it('documentos antigos (sem número) não quebram', () => {
    expect(numerosDocumentoDoKit({ documentos: { nfse: { numero_documento: undefined } } })).toEqual([])
  })
})

describe('papel timbrado (prévia HTML)', () => {
  it('título com o nº e sem a linha "Documento nº"', () => {
    expect(tituloComNumero('Nota de Débito', 16)).toBe('Nota de Débito nº 16')
    expect(tituloComNumero('Nota de Débito', null)).toBe('Nota de Débito')
    const html = montarDocumento({ doc: { titulo: 'Nota de Débito', numero: 16, emissao: '18/10/2026' }, conteudo: '' })
    expect(html).toContain('<h1>Nota de Débito nº 16</h1>')
    expect(html).toContain('<title>Nota de Débito nº 16</title>')
    expect(html).not.toContain('Documento nº')
  })
})
