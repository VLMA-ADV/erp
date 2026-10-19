import { describe, expect, it } from 'vitest'
import { resolverGrupoImposto } from './impostos-nfse'
import { montarQuadroImpostos, retencoesDaNota, type NotaEmitidaRetencoes } from './quadro-impostos'

const PJ = resolverGrupoImposto({
  nome: 'PJ Nacional', retem_irrf: true, retem_pis: true, retem_cofins: true, retem_csll: true, respeita_minimo: true,
  aliquota_irrf: 1.5, aliquota_pis: 0.65, aliquota_cofins: 3, aliquota_csll: 1, aliquota_iss: 3.5,
  min_calc_irrf: 666.67, min_calc_pis_cofins_csll: 215.34, min_ret_irrf: 10, min_ret_pis: 1.4, min_ret_cofins: 6.46, min_ret_csll: 2.15,
  tipo_retencao_iss: 1,
}, 'PJ')

// NF 2235 (FSX, 15/10) como get_quadro_impostos_kit devolve — testado em BEGIN/ROLLBACK em produção.
const NF_2235: NotaEmitidaRetencoes = {
  nota_id: 'df5085d0', pagador_cliente_id: 'fsx', pagador_nome: 'FSX Participações', nfse_numero: '2235',
  valor_total: 5409.25, valor_irrf: 81.14, valor_pis: 35.16, valor_cofins: 162.28, valor_pis_cofins_csll: 251.53,
  valor_inss: 0, valor_iss_retido: 0, valor_liquido: 5076.58,
}

describe('retencoesDaNota', () => {
  it('CSLL = retenção unificada − PIS − COFINS', () => {
    expect(retencoesDaNota(NF_2235)).toEqual({
      bruto: 5409.25,
      retencoes: { irrf: 81.14, pis: 35.16, cofins: 162.28, csll: 54.09, inss: 0, iss: 0 },
      liquido: 5076.58,
    })
  })
})

describe('montarQuadroImpostos', () => {
  const pagadores = [
    { cliente_id: 'fsx', nome: 'FSX Participações', percentual: 50 },
    { cliente_id: 'gs', nome: 'GS Participações LTDA', percentual: 50 },
  ]

  it('rateio: pagador com nota usa os valores reais; o outro é estimado', () => {
    const q = montarQuadroImpostos({
      pagadores, valorServico: 10818.5, grupo: PJ, acumuladoAtual: { gs: 5409.25 }, contratoClienteId: 'gs',
      notas: [NF_2235], nomePadrao: 'GS',
    })
    expect(q.map((l) => [l.nome, l.origem, l.nfseNumero ?? null, l.bruto, l.liquido])).toEqual([
      ['FSX Participações', 'emitida', '2235', 5409.25, 5076.58],
      ['GS Participações LTDA', 'estimado', null, 5409.25, 5076.58],
    ])
    // A estimativa bate com a NF 2236 que a GS recebeu de fato.
    expect(q[1].retencoes).toEqual({ irrf: 81.14, pis: 35.16, cofins: 162.28, csll: 54.09, inss: 0, iss: 0 })
  })

  it('rateio 50/50 abaixo do mínimo: cada metade é estimada sozinha', () => {
    const q = montarQuadroImpostos({ pagadores, valorServico: 1000, grupo: PJ, acumuladoAtual: {}, contratoClienteId: 'x', notas: [], nomePadrao: 'C' })
    expect(q.map((l) => l.retencoes.irrf)).toEqual([0, 0])
    expect(q.map((l) => l.liquido)).toEqual([476.75, 476.75])
  })

  it('sem rateio (kit sem pagadores): uma linha para o cliente do contrato', () => {
    const q = montarQuadroImpostos({ pagadores: [], valorServico: 700, grupo: PJ, acumuladoAtual: {}, contratoClienteId: 'c', notas: [], nomePadrao: 'Paradão Auto Posto' })
    expect(q).toHaveLength(1)
    expect(q[0]).toMatchObject({ nome: 'Paradão Auto Posto', bruto: 700, liquido: 656.95, origem: 'estimado' })
  })

  it('sem grupo de impostos: bruto = líquido, origem "sem_grupo"', () => {
    const q = montarQuadroImpostos({ pagadores: [pagadores[0]], valorServico: 900, grupo: null, acumuladoAtual: {}, contratoClienteId: 'fsx', notas: [], nomePadrao: 'C' })
    expect(q[0]).toMatchObject({ bruto: 450, liquido: 450, origem: 'sem_grupo' }) // 50% de 900
  })

  it('nota emitida para pagador fora do rateio do kit entra no quadro', () => {
    const q = montarQuadroImpostos({
      pagadores: [{ cliente_id: 'gs', nome: 'GS', percentual: 100 }], valorServico: 5409.25, grupo: PJ,
      acumuladoAtual: {}, contratoClienteId: 'gs', notas: [NF_2235], nomePadrao: 'GS',
    })
    expect(q.map((l) => [l.nome, l.origem, l.percentual])).toEqual([['GS', 'estimado', 100], ['FSX Participações', 'emitida', null]])
  })

  it('nota antiga sem pagador gravado, kit com um pagador: a nota é dele', () => {
    const q = montarQuadroImpostos({
      pagadores: [{ cliente_id: 'gs', nome: 'GS', percentual: 100 }], valorServico: 5409.25, grupo: PJ,
      acumuladoAtual: {}, contratoClienteId: 'gs', notas: [{ ...NF_2235, pagador_cliente_id: null }], nomePadrao: 'GS',
    })
    expect(q).toHaveLength(1)
    expect(q[0]).toMatchObject({ origem: 'emitida', nfseNumero: '2235' })
  })
})
