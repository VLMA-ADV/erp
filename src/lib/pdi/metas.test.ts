import { describe, expect, it } from 'vitest'
import {
  agregarPainel,
  copiarMetas,
  destinosDeCopia,
  payloadMetas,
  rotuloPeriodo,
  validarEnvioPeriodo,
  type MetaPeriodo,
  type PainelDados,
} from './metas'

function meta(p: Partial<MetaPeriodo> & { id: string }): MetaPeriodo {
  return { periodo: 'S1', nome: 'Meta', comentario: null, progresso_pct: 0, faixa_auto: null, ...p }
}

function geradorIds() {
  let i = 0
  return () => `new-${++i}`
}

describe('copiarMetas', () => {
  const s1 = [
    meta({ id: 'a', nome: 'Organizar eventos', descricao: 'trimestral', indicadores: '4 eventos', faixa_auto: 'acima_do_esperado', progresso_pct: 80, comentario: 'feito', faixa_final: 'dentro_da_media', anexos: [{ id: 'x', arquivo_nome: 'f.pdf', mime_type: null, tamanho_bytes: 1, storage_path: 'p' }] }),
    meta({ id: 'b', nome: '  Produto técnico ' }),
    meta({ id: 'c', nome: '   ' }),
  ]

  it('copia nome/descrição/indicadores e zera a entrega do período novo', () => {
    const out = copiarMetas(s1, [], 'S2', geradorIds())
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({
      id: 'new-1', periodo: 'S2', nome: 'Organizar eventos', descricao: 'trimestral', indicadores: '4 eventos',
      faixa_auto: null, progresso_pct: 0, comentario: null, faixa_final: null, anexos: [], _new: true,
    })
    expect(out[1].nome).toBe('Produto técnico')
  })

  it('não mexe nas metas de origem', () => {
    copiarMetas(s1, [], 'S2', geradorIds())
    expect(s1[0].faixa_auto).toBe('acima_do_esperado')
    expect(s1[0].anexos).toHaveLength(1)
  })

  it('mantém o que já existe no destino e não duplica pelo nome (caixa/acento/espaço)', () => {
    const destino = [meta({ id: 'd', periodo: 'S2', nome: 'PRODUTO   tecnico', faixa_auto: 'a_melhorar' })]
    const out = copiarMetas(s1, destino, 'S2', geradorIds())
    expect(out.map((m) => m.id)).toEqual(['d', 'new-1'])
    expect(out[0].faixa_auto).toBe('a_melhorar')
    expect(out[1].nome).toBe('Organizar eventos')
  })

  it('não duplica nomes repetidos dentro da própria origem', () => {
    const out = copiarMetas([meta({ id: '1', nome: 'X' }), meta({ id: '2', nome: 'x' })], [], 'T1', geradorIds())
    expect(out).toHaveLength(1)
  })
})

describe('validarEnvioPeriodo', () => {
  it('exige ao menos uma meta', () => {
    expect(validarEnvioPeriodo([])).toMatch(/ao menos uma meta/)
  })
  it('exige nome e autoavaliação em todas', () => {
    expect(validarEnvioPeriodo([meta({ id: '1', nome: '', faixa_auto: 'a_melhorar' })])).toMatch(/sem nome/)
    expect(validarEnvioPeriodo([meta({ id: '1', nome: 'ok' }), meta({ id: '2', nome: 'ok2' })])).toBe('2 meta(s) sem autoavaliação.')
    expect(validarEnvioPeriodo([meta({ id: '1', nome: 'ok', faixa_auto: 'fora_da_curva' })])).toBeNull()
  })
})

describe('payloadMetas', () => {
  it('manda id vazio para meta nova, descrição só na nova e limita o progresso', () => {
    const out = payloadMetas([
      meta({ id: 'new-1', _new: true, nome: 'n', descricao: 'd', progresso_pct: 140 }),
      meta({ id: 'uuid-1', nome: 'v', descricao: 'antiga', progresso_pct: -3 }),
    ])
    expect(out[0]).toMatchObject({ id: '', descricao: 'd', progresso_pct: 100 })
    expect(out[1]).toMatchObject({ id: 'uuid-1', progresso_pct: 0 })
    expect('descricao' in out[1]).toBe(false)
  })
})

describe('períodos', () => {
  it('rótulos e destinos de cópia', () => {
    expect(rotuloPeriodo('T3')).toBe('3º trimestre')
    expect(destinosDeCopia('S1', new Set(['S2']))).toEqual(['T1', 'T2', 'T3', 'T4'])
  })
})

describe('agregarPainel', () => {
  const dados: PainelDados = {
    pessoas: [
      { colaborador_id: 'p1', nome: 'Bruno', area: 'Societário', cargo: 'Pleno', avaliacao_id: 'a1' },
      { colaborador_id: 'p2', nome: 'Ana', area: 'Societário', cargo: 'Junior', avaliacao_id: 'a2' },
      { colaborador_id: 'p3', nome: 'Caio', area: 'Contencioso', cargo: null, avaliacao_id: null },
    ],
    metas: [
      { meta_id: 'm1', colaborador_id: 'p1', periodo: 'S1', nome: 'A', faixa_auto: 'dentro_da_media', faixa_final: null, progresso_pct: 100, qtd_anexos: 1 },
      { meta_id: 'm2', colaborador_id: 'p1', periodo: 'S2', nome: 'B', faixa_auto: null, faixa_final: null, progresso_pct: 20, qtd_anexos: 0 },
      { meta_id: 'm3', colaborador_id: 'p2', periodo: 'S1', nome: 'C', faixa_auto: 'fora_da_curva', faixa_final: null, progresso_pct: 50, qtd_anexos: 0 },
    ],
    envios: [
      { colaborador_id: 'p1', periodo: 'S1', enviado_em: '2026-07-01T00:00:00Z' },
      // envio de período sem meta no filtro não conta
      { colaborador_id: 'p3', periodo: 'T1', enviado_em: '2026-04-01T00:00:00Z' },
    ],
  }

  it('KPIs gerais', () => {
    const r = agregarPainel(dados)
    expect(r.kpis).toEqual({ pessoas: 3, pessoasComMetas: 2, metas: 3, progressoMedio: 57, enviados: 1, pendentes: 2 })
    expect(r.semAutoavaliacao).toBe(1)
    expect(r.porFaixa.find((f) => f.codigo === 'fora_da_curva')?.total).toBe(1)
    expect(r.porFaixa.map((f) => f.codigo)).toEqual(['baixa_performance', 'a_melhorar', 'dentro_da_media', 'acima_do_esperado', 'fora_da_curva'])
  })

  it('filtra por período', () => {
    const r = agregarPainel(dados, { periodo: 'S1' })
    expect(r.kpis).toMatchObject({ metas: 2, progressoMedio: 75, enviados: 1, pendentes: 1 })
    const p1 = r.pessoas.find((p) => p.pessoa.colaborador_id === 'p1')!
    expect(p1.periodos).toEqual([{ periodo: 'S1', enviado: true, enviado_em: '2026-07-01T00:00:00Z' }])
  })

  it('agrupa por área, ordena por progresso e lista integrantes por nome', () => {
    const r = agregarPainel(dados)
    expect(r.porArea.map((a) => [a.area, a.pessoas, a.metas, a.progresso])).toEqual([
      ['Societário', 2, 3, 57],
      ['Contencioso', 1, 0, null],
    ])
    expect(r.porArea[0].integrantes.map((i) => i.pessoa.nome)).toEqual(['Ana', 'Bruno'])
    expect(r.pessoas.find((p) => p.pessoa.colaborador_id === 'p3')!.progresso).toBeNull()
  })

  it('filtra por área', () => {
    const r = agregarPainel(dados, { area: 'Contencioso' })
    expect(r.kpis).toMatchObject({ pessoas: 1, metas: 0, progressoMedio: null, enviados: 0, pendentes: 0 })
  })
})
