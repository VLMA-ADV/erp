import { describe, expect, it } from 'vitest'
import {
  CHAVE_SEM_CENTRO_CUSTO,
  SEM_CENTRO_CUSTO,
  competenciaInicialDoRateio,
  competenciasDoRateio,
  cut,
  cutSeCobrarRevisao,
  filtrarRateio,
  formatarCut,
  lerLancamentosRateio,
  montarRelatorio,
  opcoesDosFiltros,
  totalizar,
} from './rateio-horas'

// Linha como get_rateio_horas devolve (jsonb).
function linha(over: Record<string, unknown> = {}) {
  return {
    timesheet_id: `ts-${Math.random().toString(36).slice(2)}`,
    billing_item_id: 'bi-1',
    competencia: '2026-10-01',
    data_lancamento: '2026-09-10',
    descricao: 'Reunião',
    cliente_id: 'cli-a',
    cliente_nome: 'Cliente A',
    contrato_id: 'ct-1',
    contrato_numero: 10,
    caso_id: 'caso-1',
    caso_numero: 100,
    caso_nome: 'Consultivo',
    usuario_id: 'u-1',
    usuario_nome: 'Ana',
    area_id: 'area-soc',
    area_nome: 'Societário',
    horas_lancadas: 2,
    horas_cobradas: 2,
    etapa: 'aprovado',
    situacao: 'cobrada',
    ...over,
  }
}

describe('lerLancamentosRateio', () => {
  it('converte números em texto e descarta linha sem timesheet', () => {
    const [l, ...resto] = lerLancamentosRateio([
      linha({ horas_lancadas: '1.50', horas_cobradas: '0.75', caso_numero: '7' }),
      { cliente_nome: 'sem id' },
      null,
    ])
    expect(resto).toHaveLength(0)
    expect(l.horasLancadas).toBe(1.5)
    expect(l.horasCobradas).toBe(0.75)
    expect(l.casoNumero).toBe(7)
  })

  it('pessoa sem área vai para "Sem centro de custo"', () => {
    const [l] = lerLancamentosRateio([linha({ area_id: null, area_nome: null })])
    expect(l.areaId).toBeNull()
    expect(l.areaNome).toBeNull()
    const rel = montarRelatorio([l])
    expect(rel.centrosCusto).toEqual([
      expect.objectContaining({ chave: CHAVE_SEM_CENTRO_CUSTO, nome: SEM_CENTRO_CUSTO }),
    ])
  })

  it('situação/etapa desconhecidas caem em revisão (não contam como cobradas nem cortadas)', () => {
    const [l] = lerLancamentosRateio([linha({ etapa: 'xyz', situacao: 'xyz' })])
    expect(l.situacao).toBe('em_revisao')
    expect(l.etapa).toBe('em_revisao')
  })

  it('payload que não é lista vira lista vazia', () => {
    expect(lerLancamentosRateio(null)).toEqual([])
    expect(lerLancamentosRateio({})).toEqual([])
  })
})

describe('cut', () => {
  it('é 1 − cobradas ÷ lançadas', () => {
    expect(cut({ lancadas: 10, cobradas: 6 })).toBeCloseTo(0.4)
    expect(cut({ lancadas: 10, cobradas: 10 })).toBe(0)
    expect(cut({ lancadas: 10, cobradas: 0 })).toBe(1)
  })

  it('sem lançadas não há cut', () => {
    expect(cut({ lancadas: 0, cobradas: 0 })).toBeNull()
  })

  it('fica negativo quando o aprovador cobra mais do que foi lançado', () => {
    expect(cut({ lancadas: 2, cobradas: 3 })).toBeCloseTo(-0.5)
  })

  it('em revisão conta como não cobrada; o piso mostra o cut se tudo for cobrado', () => {
    const t = totalizar(lerLancamentosRateio([
      linha({ horas_lancadas: 4, horas_cobradas: 3, situacao: 'cobrada' }),
      linha({ horas_lancadas: 2, horas_cobradas: 0, situacao: 'cortada', etapa: 'ignorado' }),
      linha({ horas_lancadas: 4, horas_cobradas: 0, situacao: 'em_revisao', etapa: 'em_revisao' }),
    ]))
    expect(t).toEqual({ lancadas: 10, cobradas: 3, emRevisao: 4, lancamentos: 3 })
    expect(cut(t)).toBeCloseTo(0.7)
    expect(cutSeCobrarRevisao(t)).toBeCloseTo(0.3)
  })

  it('formata com uma casa decimal', () => {
    expect(formatarCut(0.345)).toBe('34,5%')
    expect(formatarCut(0)).toBe('0,0%')
    expect(formatarCut(null)).toBe('—')
  })

  it('soma sem resíduo de ponto flutuante', () => {
    const t = totalizar(lerLancamentosRateio([linha({ horas_lancadas: 0.1 }), linha({ horas_lancadas: 0.2 })]))
    expect(t.lancadas).toBe(0.3)
  })
})

describe('montarRelatorio', () => {
  const dados = lerLancamentosRateio([
    // caso 1 (Cliente A): Societário cobra 2 de 2; Contratos cobra 1 de 3; Ana sem área 1h em revisão
    linha({ caso_id: 'c1', caso_numero: 1, usuario_id: 'u-soc', usuario_nome: 'Sol', area_id: 'soc', area_nome: 'Societário', horas_lancadas: 2, horas_cobradas: 2 }),
    linha({ caso_id: 'c1', caso_numero: 1, usuario_id: 'u-con', usuario_nome: 'Caio', area_id: 'con', area_nome: 'Contratos', horas_lancadas: 3, horas_cobradas: 1 }),
    linha({ caso_id: 'c1', caso_numero: 1, usuario_id: 'u-sem', usuario_nome: 'Ana', area_id: null, area_nome: null, horas_lancadas: 1, horas_cobradas: 0, situacao: 'em_revisao', etapa: 'na_fila' }),
    // caso 2 (Cliente B): Contratos cobra 4 de 4
    linha({ caso_id: 'c2', caso_numero: 2, cliente_id: 'cli-b', cliente_nome: 'Banco B', usuario_id: 'u-con', usuario_nome: 'Caio', area_id: 'con', area_nome: 'Contratos', horas_lancadas: 4, horas_cobradas: 4 }),
    // caso 3 (Cliente A): tudo cortado (excluído da fila)
    linha({ caso_id: 'c3', caso_numero: 3, usuario_id: 'u-soc', usuario_nome: 'Sol', area_id: 'soc', area_nome: 'Societário', horas_lancadas: 1, horas_cobradas: 0, situacao: 'cortada', etapa: 'excluido_fila' }),
  ])

  it('totais do mês e cut geral', () => {
    const rel = montarRelatorio(dados)
    expect(rel.totais).toEqual({ lancadas: 11, cobradas: 7, emRevisao: 1, lancamentos: 5 })
    expect(cut(rel.totais)).toBeCloseTo(4 / 11)
  })

  it('centros de custo: mais cobradas primeiro, "Sem centro de custo" por último', () => {
    const rel = montarRelatorio(dados)
    expect(rel.centrosCusto.map((c) => [c.nome, c.totais.cobradas, c.totais.lancadas])).toEqual([
      ['Contratos', 5, 7],
      ['Societário', 2, 3],
      [SEM_CENTRO_CUSTO, 0, 1],
    ])
    // a rosca (cobradas por centro de custo) fecha com o total cobrado
    expect(rel.centrosCusto.reduce((s, c) => s + c.totais.cobradas, 0)).toBe(rel.totais.cobradas)
  })

  it('uma linha por caso, ordenada por cliente e número, com as colunas por centro de custo', () => {
    const rel = montarRelatorio(dados)
    expect(rel.casos.map((c) => [c.clienteNome, c.casoNumero])).toEqual([
      ['Banco B', 2],
      ['Cliente A', 1],
      ['Cliente A', 3],
    ])
    const c1 = rel.casos.find((c) => c.casoId === 'c1')!
    expect(c1.totais).toEqual({ lancadas: 6, cobradas: 3, emRevisao: 1, lancamentos: 3 })
    expect(c1.porCentroCusto.soc).toMatchObject({ lancadas: 2, cobradas: 2 })
    expect(c1.porCentroCusto.con).toMatchObject({ lancadas: 3, cobradas: 1 })
    expect(c1.porCentroCusto[CHAVE_SEM_CENTRO_CUSTO]).toMatchObject({ lancadas: 1, cobradas: 0, emRevisao: 1 })
    expect(c1.lancamentos).toHaveLength(3)
    // soma das colunas = cobradas do caso
    expect(Object.values(c1.porCentroCusto).reduce((s, t) => s + t.cobradas, 0)).toBe(c1.totais.cobradas)
  })

  it('sem lançamentos: tudo zerado e cut indefinido', () => {
    const rel = montarRelatorio([])
    expect(rel.totais.lancadas).toBe(0)
    expect(rel.casos).toEqual([])
    expect(cut(rel.totais)).toBeNull()
  })

  it('filtros valem para o dashboard e a tabela', () => {
    expect(totalizar(filtrarRateio(dados, { centroCusto: 'con' }))).toMatchObject({ lancadas: 7, cobradas: 5 })
    expect(totalizar(filtrarRateio(dados, { centroCusto: CHAVE_SEM_CENTRO_CUSTO }))).toMatchObject({ lancadas: 1, cobradas: 0 })
    expect(totalizar(filtrarRateio(dados, { usuario: 'u-soc' }))).toMatchObject({ lancadas: 3, cobradas: 2 })
    expect(totalizar(filtrarRateio(dados, { cliente: 'cli-a' }))).toMatchObject({ lancadas: 7, cobradas: 3 })
    expect(totalizar(filtrarRateio(dados, { cliente: 'cli-a', caso: 'c3' }))).toMatchObject({ lancadas: 1, cobradas: 0 })
    expect(filtrarRateio(dados, {})).toHaveLength(5)
  })

  it('opções dos filtros: sem repetição; caso respeita o cliente', () => {
    const op = opcoesDosFiltros(dados)
    expect(op.usuarios.map((o) => o.label)).toEqual(['Ana', 'Caio', 'Sol'])
    expect(op.centrosCusto.map((o) => o.label)).toEqual(['Contratos', 'Societário', SEM_CENTRO_CUSTO])
    expect(op.clientes.map((o) => o.value)).toEqual(['cli-b', 'cli-a'])
    expect(opcoesDosFiltros(dados, 'cli-a').casos.map((o) => o.value).sort()).toEqual(['c1', 'c3'])
  })
})

describe('abas de competência', () => {
  it('de agosto/2026 até o mês seguinte ao corrente', () => {
    expect(competenciasDoRateio('2026-10-01')).toEqual(['2026-08-01', '2026-09-01', '2026-10-01', '2026-11-01'])
    expect(competenciasDoRateio('2027-01-15')).toHaveLength(7)
  })

  it('competência inicial: a pedida se existir; senão o mês corrente', () => {
    expect(competenciaInicialDoRateio('2026-09-01', '2026-10-01')).toBe('2026-09-01')
    expect(competenciaInicialDoRateio('2026-03-01', '2026-10-01')).toBe('2026-10-01')
    expect(competenciaInicialDoRateio(null, '2026-10-01')).toBe('2026-10-01')
  })
})
