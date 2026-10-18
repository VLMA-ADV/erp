import { describe, expect, it } from 'vitest'
import { linhasDoRelatorio } from './linhas-relatorio'
import type { ItemKit, LinhaTimesheet } from './types'

const linha = (extra: Partial<LinhaTimesheet> = {}): LinhaTimesheet => ({
  data: '2026-09-03',
  profissional: 'Ana Souza',
  cargo: 'Sócia',
  descricao: 'Reunião',
  horas: 1.5,
  valor_hora: 500,
  valor: 750,
  ...extra,
})

const item = (extra: Partial<ItemKit> = {}): ItemKit => ({
  id: 'i1',
  origem_tipo: 'timesheet',
  descricao: 'Timesheet',
  data_referencia: '2026-09-03',
  horas: 1.5,
  valor: 750,
  status: 'aprovado',
  linhas_timesheet: [linha()],
  despesa: null,
  ...extra,
})

describe('linhasDoRelatorio', () => {
  it('mantém as linhas com horas de itens aprovados e faturados', () => {
    const r = linhasDoRelatorio([item(), item({ id: 'i2', status: 'faturado' })])
    expect(r.visiveis).toHaveLength(2)
    expect(r.ocultas).toHaveLength(0)
    expect(r.valorOculto).toBe(0)
  })

  it('oculta linha de 0h (horas efetivas = 0) sem valor', () => {
    const r = linhasDoRelatorio([item({
      linhas_timesheet: [linha(), linha({ horas: 0, valor: 0 }), linha({ horas: 0.001, valor: 0 })],
    })])
    expect(r.visiveis).toHaveLength(1)
    expect(r.ocultas.map((o) => o.motivo)).toEqual(['zero_horas', 'zero_horas'])
  })

  it('não oculta 0h que ainda carrega valor (não some dinheiro do total)', () => {
    const r = linhasDoRelatorio([item({ linhas_timesheet: [linha({ horas: 0, valor: 120 })] })])
    expect(r.visiveis).toHaveLength(1)
    expect(r.ocultas).toHaveLength(0)
  })

  it('oculta todas as linhas de itens excluídos (cancelado) e ignorados, somando o valor oculto', () => {
    const r = linhasDoRelatorio([
      item(),
      item({ id: 'ign', status: 'ignorado', linhas_timesheet: [linha({ valor: 300 }), linha({ valor: 200 })] }),
      item({ id: 'exc', status: 'cancelado', linhas_timesheet: [linha({ valor: 100.1 })] }),
    ])
    expect(r.visiveis.map((v) => v.item.id)).toEqual(['i1'])
    expect(r.ocultas.map((o) => [o.item.id, o.motivo])).toEqual([
      ['ign', 'ignorada'], ['ign', 'ignorada'], ['exc', 'excluida'],
    ])
    expect(r.valorOculto).toBe(600.1)
  })

  it('ignora itens que não são de timesheet', () => {
    const r = linhasDoRelatorio([
      item({ id: 'd', origem_tipo: 'despesa', linhas_timesheet: [] }),
      item({ id: 'm', origem_tipo: 'regra_financeira', linhas_timesheet: [linha()] }),
    ])
    expect(r.visiveis).toHaveLength(0)
    expect(r.ocultas).toHaveLength(0)
  })
})
