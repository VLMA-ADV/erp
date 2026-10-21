import { describe, expect, it } from 'vitest'
import { estaEmValidacao, idsParaAtivar, rotuloQuantidadeContratos } from './contrato-ativacao'

describe('estaEmValidacao', () => {
  it('aceita em_analise e o legado validacao', () => {
    expect(estaEmValidacao('em_analise')).toBe(true)
    expect(estaEmValidacao('validacao')).toBe(true)
  })
  it('recusa os demais', () => {
    for (const s of ['ativo', 'rascunho', 'encerrado', 'solicitacao', '', null, undefined]) {
      expect(estaEmValidacao(s)).toBe(false)
    }
  })
})

describe('idsParaAtivar', () => {
  const lista = [
    { id: 'a', status: 'em_analise' },
    { id: 'b', status: 'ativo' },
    { id: 'c', status: 'em_analise' },
    { id: 'd', status: 'rascunho' },
  ]
  it('só devolve selecionados em validação', () => {
    expect(idsParaAtivar(lista, new Set(['a', 'b', 'c', 'd']))).toEqual(['a', 'c'])
  })
  it('ignora seleção que não está mais na lista', () => {
    expect(idsParaAtivar(lista, new Set(['x', 'c']))).toEqual(['c'])
  })
  it('vazio sem seleção', () => {
    expect(idsParaAtivar(lista, new Set())).toEqual([])
  })
})

describe('rotuloQuantidadeContratos', () => {
  it('singular e plural', () => {
    expect(rotuloQuantidadeContratos(1)).toBe('1 contrato')
    expect(rotuloQuantidadeContratos(2)).toBe('2 contratos')
    expect(rotuloQuantidadeContratos(0)).toBe('0 contratos')
  })
})
