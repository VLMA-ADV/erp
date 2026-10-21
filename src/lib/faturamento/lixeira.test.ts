import { describe, expect, it } from 'vitest'
import {
  ROTULO_TIPO_LIXEIRA,
  avisosDeRestauracao,
  chaveDoItem,
  filtrarLixeira,
  idDoItem,
  lerPayloadLixeira,
  mesesDaLixeira,
  parametrosDeRestauracao,
  rotuloDiasRestantes,
  tipoDoItem,
  type ItemLixeira,
} from './lixeira'

function item(over: Partial<ItemLixeira> = {}): ItemLixeira {
  return {
    timesheet_id: 't1',
    cliente_id: 'cli1',
    cliente_nome: 'Barigui Veículos Ltda',
    contrato_id: 'ct1',
    contrato_numero: 871,
    contrato_numero_sequencial: 528,
    contrato_nome: 'Contrato 528',
    contrato_ativo: true,
    caso_id: 'cs1',
    caso_numero: 1934,
    caso_nome: 'Mútuo Conversível',
    caso_ativo: true,
    profissional_nome: 'Bruna Fedatto',
    data_lancamento: '2026-08-31',
    horas: 4,
    descricao: 'Ajustes em contrato',
    excluido_por_id: 'u1',
    excluido_por_nome: 'Jessika Lira',
    excluido_em: '2026-10-16T12:00:00Z',
    motivo: 'duplicado',
    mes_original: '2026-09-01',
    mes_destino: '2026-10-01',
    expira_em: '2027-10-16T12:00:00Z',
    dias_restantes: 365,
    kit_no_mes_original: false,
    nfse_no_mes_original: null,
    ...over,
  }
}

describe('lerPayloadLixeira', () => {
  it('normaliza payload vazio ou inválido', () => {
    expect(lerPayloadLixeira(null)).toEqual({ pode_restaurar: false, mes_destino: '', itens: [] })
    expect(lerPayloadLixeira({ pode_restaurar: 'sim', itens: 'x' })).toEqual({ pode_restaurar: false, mes_destino: '', itens: [] })
  })

  it('mantém o que veio da RPC', () => {
    const p = lerPayloadLixeira({ pode_restaurar: true, mes_destino: '2026-10-01', itens: [item()] })
    expect(p.pode_restaurar).toBe(true)
    expect(p.itens).toHaveLength(1)
  })
})

describe('filtrarLixeira', () => {
  const itens = [
    item(),
    item({ timesheet_id: 't2', contrato_numero_sequencial: 77, contrato_nome: 'Contrato 77', cliente_nome: 'Outro Cliente', caso_numero: 10, caso_nome: 'Trabalhista', mes_original: '2026-08-01', motivo: null, descricao: 'Audiência', profissional_nome: 'Cinesvaldo' }),
  ]

  it('sem filtro devolve tudo', () => {
    expect(filtrarLixeira(itens, {})).toHaveLength(2)
  })

  it('busca ignora acento e caixa', () => {
    expect(filtrarLixeira(itens, { busca: 'MUTUO' }).map((i) => i.timesheet_id)).toEqual(['t1'])
    expect(filtrarLixeira(itens, { busca: 'audiencia' }).map((i) => i.timesheet_id)).toEqual(['t2'])
  })

  it('busca por número do contrato canônico, caso, motivo e quem excluiu', () => {
    expect(filtrarLixeira(itens, { busca: '528' }).map((i) => i.timesheet_id)).toEqual(['t1'])
    expect(filtrarLixeira(itens, { busca: '1934' }).map((i) => i.timesheet_id)).toEqual(['t1'])
    expect(filtrarLixeira(itens, { busca: 'duplicado' }).map((i) => i.timesheet_id)).toEqual(['t1'])
    expect(filtrarLixeira(itens, { busca: 'jessika' })).toHaveLength(2)
  })

  it('filtra pelo mês original aceitando YYYY-MM', () => {
    expect(filtrarLixeira(itens, { mes: '2026-08' }).map((i) => i.timesheet_id)).toEqual(['t2'])
    expect(filtrarLixeira(itens, { mes: '2026-09-01', busca: 'cines' })).toHaveLength(0)
  })
})

describe('mesesDaLixeira', () => {
  it('únicos, do mais recente para o mais antigo', () => {
    const meses = mesesDaLixeira([
      item({ mes_original: '2026-08-01' }),
      item({ mes_original: '2026-09-01' }),
      item({ mes_original: '2026-08-01' }),
    ])
    expect(meses).toEqual(['2026-09-01', '2026-08-01'])
  })
})

describe('rotuloDiasRestantes', () => {
  it('formata dias', () => {
    expect(rotuloDiasRestantes(0)).toBe('sai hoje')
    expect(rotuloDiasRestantes(-3)).toBe('sai hoje')
    expect(rotuloDiasRestantes(1)).toBe('1 dia')
    expect(rotuloDiasRestantes(30)).toBe('30 dias')
    expect(rotuloDiasRestantes(null)).toBe('sai hoje')
  })
})

describe('avisosDeRestauracao', () => {
  it('sem kit nem nota, nada a avisar', () => {
    expect(avisosDeRestauracao([item()])).toEqual([])
  })

  it('avisa kit montado no mês original, uma vez por caso+mês', () => {
    const avisos = avisosDeRestauracao([
      item({ kit_no_mes_original: true }),
      item({ timesheet_id: 't2', kit_no_mes_original: true }),
    ])
    expect(avisos).toHaveLength(1)
    expect(avisos[0]).toContain('caso 1934')
    expect(avisos[0]).toContain('setembro de 2026')
    expect(avisos[0]).toContain('kit')
    expect(avisos[0]).toContain('outubro de 2026')
  })

  it('NFS-e tem prioridade sobre kit na mensagem', () => {
    const avisos = avisosDeRestauracao([item({ kit_no_mes_original: true, nfse_no_mes_original: '1888' })])
    expect(avisos).toHaveLength(1)
    expect(avisos[0]).toContain('NFS-e 1888')
  })

  it('avisa contrato ou caso inativo', () => {
    const avisos = avisosDeRestauracao([item({ contrato_ativo: false })])
    expect(avisos).toHaveLength(1)
    expect(avisos[0]).toContain('contrato está inativo')
  })

  it('casos diferentes geram avisos separados', () => {
    const avisos = avisosDeRestauracao([
      item({ kit_no_mes_original: true }),
      item({ timesheet_id: 't2', caso_id: 'cs2', caso_numero: 10, kit_no_mes_original: true }),
    ])
    expect(avisos).toHaveLength(2)
  })
})

describe('etapa 2: tipos (excluído da fila, timesheet apagado, despesa apagada)', () => {
  const despesa = item({
    tipo: 'despesa_apagada',
    id: 'd1',
    chave: 'despesa_apagada:d1',
    timesheet_id: null,
    despesa_id: 'd1',
    horas: 0,
    valor: 150.5,
    categoria: 'Custas',
    descricao: 'Guia de recolhimento',
    motivo: null,
  })
  const apagado = item({ tipo: 'timesheet_apagado', id: 't9', chave: 'timesheet_apagado:t9', timesheet_id: 't9', motivo: null })

  it('item sem tipo (payload da etapa 1) é excluído da fila', () => {
    expect(tipoDoItem(item())).toBe('excluido_fila')
    expect(chaveDoItem(item())).toBe('excluido_fila:t1')
    expect(idDoItem(item())).toBe('t1')
  })

  it('usa a chave e o id que vêm da RPC', () => {
    expect(tipoDoItem(despesa)).toBe('despesa_apagada')
    expect(chaveDoItem(despesa)).toBe('despesa_apagada:d1')
    expect(idDoItem(despesa)).toBe('d1')
    expect(chaveDoItem(apagado)).toBe('timesheet_apagado:t9')
  })

  it('separa a seleção por tipo para a restauração', () => {
    expect(parametrosDeRestauracao([item(), apagado, despesa])).toEqual({
      p_excluidos: ['t1'],
      p_timesheets: ['t9'],
      p_despesas: ['d1'],
    })
    expect(parametrosDeRestauracao([])).toEqual({ p_excluidos: [], p_timesheets: [], p_despesas: [] })
  })

  it('filtra por tipo e busca pela categoria da despesa', () => {
    const itens = [item(), apagado, despesa]
    expect(filtrarLixeira(itens, { tipo: 'despesa_apagada' }).map(idDoItem)).toEqual(['d1'])
    expect(filtrarLixeira(itens, { tipo: 'excluido_fila' }).map(idDoItem)).toEqual(['t1'])
    expect(filtrarLixeira(itens, { tipo: '' })).toHaveLength(3)
    expect(filtrarLixeira(itens, { busca: 'custas' }).map(idDoItem)).toEqual(['d1'])
  })

  it('tem rótulo para cada tipo', () => {
    expect(Object.keys(ROTULO_TIPO_LIXEIRA).sort()).toEqual(['despesa_apagada', 'excluido_fila', 'timesheet_apagado'])
  })
})
