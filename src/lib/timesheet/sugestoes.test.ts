import { describe, expect, it } from 'vitest'
import { escolherSugestoes, normalizarDescricao, type CandidatoSugestao } from './sugestoes'

function c(over: Partial<CandidatoSugestao>): CandidatoSugestao {
  return {
    caso_id: 'caso-a',
    contrato_id: 'ct-a',
    caso_numero: 1,
    caso_nome: 'Caso A',
    descricao: 'Reunião com o cliente',
    vezes: 1,
    ultimo_uso: '2026-10-01',
    ...over,
  }
}

const todos = () => true

describe('escolherSugestoes', () => {
  it('ordena por vezes e, no empate, pela mais recente', () => {
    const r = escolherSugestoes(
      [
        c({ descricao: 'A', vezes: 2, ultimo_uso: '2026-09-01' }),
        c({ descricao: 'B', vezes: 5, ultimo_uso: '2026-08-01' }),
        c({ descricao: 'C', vezes: 2, ultimo_uso: '2026-10-10' }),
      ],
      todos,
    )
    expect(r.map((s) => s.descricao)).toEqual(['B', 'C', 'A'])
  })

  it('devolve no máximo 5', () => {
    const muitos = Array.from({ length: 9 }, (_, i) => c({ descricao: `D${i}`, vezes: i }))
    const r = escolherSugestoes(muitos, todos)
    expect(r).toHaveLength(5)
    expect(r[0].descricao).toBe('D8')
  })

  it('junta a mesma descrição com grafia diferente no mesmo caso', () => {
    const r = escolherSugestoes(
      [
        c({ descricao: 'Reunião  com o cliente', vezes: 2, ultimo_uso: '2026-09-01' }),
        c({ descricao: 'reunião com o cliente ', vezes: 1, ultimo_uso: '2026-10-05' }),
      ],
      todos,
    )
    expect(r).toHaveLength(1)
    expect(r[0].vezes).toBe(3)
    expect(r[0].ultimo_uso).toBe('2026-10-05')
    expect(r[0].descricao).toBe('reunião com o cliente')
  })

  it('mesma descrição em casos diferentes são sugestões diferentes', () => {
    const r = escolherSugestoes([c({ caso_id: 'x' }), c({ caso_id: 'y' })], todos)
    expect(r).toHaveLength(2)
  })

  it('ignora caso que não pode ser escolhido e descrição vazia', () => {
    const r = escolherSugestoes(
      [c({ caso_id: 'encerrado', vezes: 9 }), c({ descricao: '   ', vezes: 8 }), c({ descricao: 'ok' })],
      (id) => id !== 'encerrado',
    )
    expect(r.map((s) => s.descricao)).toEqual(['ok'])
  })

  it('sem histórico, sem sugestões', () => {
    expect(escolherSugestoes([], todos)).toEqual([])
  })
})

describe('normalizarDescricao', () => {
  it('ignora caixa e espaços repetidos', () => {
    expect(normalizarDescricao('  Due  Diligence ')).toBe('due diligence')
  })
})
