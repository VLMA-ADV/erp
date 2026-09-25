import { describe, expect, it } from 'vitest'
import { mapearOrigemDasDespesas, parametrosBuscaOrigem } from './origem-despesas'

// Kit real do bug 6.3 (caso 1870, competência 09/2026).
const kit = {
  contrato_id: '2cc5b93c-9502-4397-abe5-033b76555e79',
  contrato_numero: 331,
  caso_id: '0cab0cb0-07bd-43a7-babc-eb50cebce0a7',
  caso_numero: 1870,
  competencia: '2026-09-01',
}

describe('parametrosBuscaOrigem', () => {
  it('manda competência YYYY-MM e o NÚMERO do caso, nunca o uuid (a RPC filtra por ILIKE)', () => {
    const p = parametrosBuscaOrigem(kit)
    expect(p.get('competencia')).toBe('2026-09')
    expect(p.get('caso')).toBe('1870')
    expect(p.get('contrato')).toBeNull()
    expect(p.toString()).not.toContain(kit.caso_id)
  })

  it('kit "Sem caso" usa o número do contrato', () => {
    const p = parametrosBuscaOrigem({ ...kit, caso_id: null, caso_numero: null })
    expect(p.get('caso')).toBeNull()
    expect(p.get('contrato')).toBe('331')
  })

  it('sem número nenhum, busca só pela competência', () => {
    const p = parametrosBuscaOrigem({ ...kit, caso_id: null, caso_numero: null, contrato_numero: null })
    expect([...p.keys()]).toEqual(['competencia'])
  })
})

describe('mapearOrigemDasDespesas', () => {
  const linhas = [
    // chave real da RPC é billing_item_id (não existe `id` no item)
    { billing_item_id: '27880829-922f-49a5-9267-339395ea4686', origem_tipo: 'despesa', origem_id: '104678e9-572c-420b-a8cc-98d697f6731b', contrato_id: kit.contrato_id, caso_id: kit.caso_id },
    { billing_item_id: 'dd291866-5cd6-42b8-a743-2d7e271d8b87', origem_tipo: 'despesa', origem_id: '73e2f644-cd2c-4dc4-9a96-13b7a32d1397', contrato_id: kit.contrato_id, caso_id: kit.caso_id },
    // timesheet do mesmo kit: não entra
    { billing_item_id: 'ts-1', origem_tipo: 'timesheet', origem_id: 'ts-origem', contrato_id: kit.contrato_id, caso_id: kit.caso_id },
    // despesa de OUTRO caso (o ILIKE '%187%' também traz 1870, 1871...)
    { billing_item_id: 'outro-caso', origem_tipo: 'despesa', origem_id: 'x', contrato_id: kit.contrato_id, caso_id: 'outro' },
    // despesa sem origem
    { billing_item_id: 'sem-origem', origem_tipo: 'despesa', origem_id: null, contrato_id: kit.contrato_id, caso_id: kit.caso_id },
  ]

  it('casa pelo billing_item_id e devolve o id da despesa', () => {
    const mapa = mapearOrigemDasDespesas(linhas, kit)
    expect([...mapa.entries()]).toEqual([
      ['27880829-922f-49a5-9267-339395ea4686', '104678e9-572c-420b-a8cc-98d697f6731b'],
      ['dd291866-5cd6-42b8-a743-2d7e271d8b87', '73e2f644-cd2c-4dc4-9a96-13b7a32d1397'],
    ])
  })

  it('aceita `id` como alternativa ao billing_item_id', () => {
    const mapa = mapearOrigemDasDespesas([{ id: 'a', origem_id: 'b' }], kit)
    expect(mapa.get('a')).toBe('b')
  })

  it('kit sem caso aceita linhas de qualquer caso do contrato', () => {
    const mapa = mapearOrigemDasDespesas(linhas, { ...kit, caso_id: null, caso_numero: null })
    expect(mapa.size).toBe(3)
  })

  it('resposta que não é lista vira mapa vazio', () => {
    expect(mapearOrigemDasDespesas(undefined, kit).size).toBe(0)
    expect(mapearOrigemDasDespesas({ error: 'x' }, kit).size).toBe(0)
  })
})
