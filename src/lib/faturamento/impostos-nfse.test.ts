import { describe, expect, it } from 'vitest'
import {
  acumuladosNaEmissao,
  calcularImpostosNfse,
  calcularImpostosPorPagador,
  mesDaEmissao,
  pagadoresDaEmissao,
  resolverGrupoImposto,
  type GrupoImpostoDb,
} from './impostos-nfse'

// Grupos como estão em contracts.grupos_impostos (produção, 16/10/2026).
const BASE: GrupoImpostoDb = {
  aliquota_irrf: '1.50', aliquota_pis: '0.65', aliquota_cofins: '3.00', aliquota_csll: '1.00', aliquota_iss: '3.50',
  min_calc_irrf: '666.67', min_calc_pis_cofins_csll: '215.34',
  min_ret_irrf: '10.00', min_ret_pis: '1.40', min_ret_cofins: '6.46', min_ret_csll: '2.15',
  tipo_retencao_iss: 1,
}
const PJ_NACIONAL: GrupoImpostoDb = { ...BASE, nome: 'PJ Nacional', retem_irrf: true, retem_pis: true, retem_cofins: true, retem_csll: true, respeita_minimo: true }
const PJ_SEM_MINIMO: GrupoImpostoDb = { ...BASE, nome: 'PJ sem mínimo', retem_irrf: true, retem_pis: true, retem_cofins: true, retem_csll: true, respeita_minimo: false }
const PF_NACIONAL: GrupoImpostoDb = { ...BASE, nome: 'PF Nacional', retem_irrf: false, retem_pis: false, retem_cofins: false, retem_csll: false, respeita_minimo: false }
const SEM_IRRF: GrupoImpostoDb = { ...BASE, nome: 'Sem IRRF', retem_irrf: false, retem_pis: true, retem_cofins: true, retem_csll: true, respeita_minimo: true }

const conta = (grupo: GrupoImpostoDb, valorBruto: number, acumuladoMes = 0) =>
  calcularImpostosNfse({ grupo: resolverGrupoImposto(grupo, 'PJ'), valorBruto, acumuladoMes })

describe('calcularImpostosNfse — notas reais (billing_notes.metadata, produção)', () => {
  it('NF 2238 (Paradão, 15/10): R$ 700 no limite do IRRF', () => {
    const r = conta(PJ_NACIONAL, 700)
    expect(r.irrf.valor).toBe(10.5)
    expect(r.pis.valor).toBe(4.55)
    expect(r.cofins.valor).toBe(21)
    expect(r.csll.valor).toBe(7)
    expect(r.pisCofinsCsll).toBe(32.55) // focus_request.valor_csll
    expect(r.valorLiquido).toBe(656.95) // finance.valor_liquido_da_nota
  })

  it('NF 2239 (Arroio, 16/10): R$ 2.960', () => {
    const r = conta(PJ_NACIONAL, 2960)
    expect(r.irrf.valor).toBe(44.4)
    expect(r.pis.valor).toBe(19.24)
    expect(r.cofins.valor).toBe(88.8)
    expect(r.pisCofinsCsll).toBe(137.64)
    expect(r.valorLiquido).toBe(2777.96)
  })

  it('NF 2228 + 2229 (rateio 50/50 de R$ 3.500, 14/10): cada pagador com a sua metade', () => {
    for (const metade of [1750, 1750]) {
      const r = conta(PJ_NACIONAL, metade)
      expect(r.irrf.valor).toBe(26.25)
      expect(r.pis.valor).toBe(11.38)
      expect(r.cofins.valor).toBe(52.5)
      expect(r.pisCofinsCsll).toBe(81.38)
      expect(r.valorLiquido).toBe(1642.37)
    }
  })
})

describe('calcularImpostosNfse — mínimos', () => {
  it('abaixo do mínimo de cálculo do IRRF não retém IRRF, mas retém PIS/COFINS/CSLL', () => {
    const r = conta(PJ_NACIONAL, 500)
    expect(r.irrf).toMatchObject({ valor: 0, aplicado: false, motivo: { tipo: 'base_abaixo_minimo', minCalc: 666.67, comAcumulado: false } })
    expect(r.pisCofinsCsll).toBe(23.25)
    expect(r.valorLiquido).toBe(476.75)
  })

  it('acumulado do mês leva a base acima do mínimo — e o mínimo de retenção ainda segura o IRRF', () => {
    const r = conta(PJ_NACIONAL, 500, 833.34)
    expect(r.baseCalculoMinimo).toBeCloseTo(1333.34, 2)
    expect(r.irrf).toMatchObject({ valor: 0, aplicado: false, motivo: { tipo: 'retencao_abaixo_minimo', minRet: 10 } })
  })

  it('com os mínimos de hoje, o acumulado não faz nota abaixo do mínimo de cálculo reter', () => {
    // mínimo de retenção ≈ mínimo de cálculo × alíquota: abaixo de um, o imposto
    // fica abaixo do outro. PIS 1,39 < 1,40 · COFINS 6,42 < 6,46 · CSLL 2,14 < 2,15.
    const r = conta(PJ_NACIONAL, 214, 1000)
    expect(r.pis.motivo).toEqual({ tipo: 'retencao_abaixo_minimo', minRet: 1.4 })
    expect(r.cofins.motivo).toEqual({ tipo: 'retencao_abaixo_minimo', minRet: 6.46 })
    expect(r.csll.motivo).toEqual({ tipo: 'retencao_abaixo_minimo', minRet: 2.15 })
    expect(r.totalRetencoes).toBe(0)
    // Sem acumulado, o motivo é o mínimo de cálculo.
    expect(conta(PJ_NACIONAL, 214).pis.motivo).toMatchObject({ tipo: 'base_abaixo_minimo', minCalc: 215.34 })
  })

  it('arredondamento: R$ 666,66 com acumulado retém IRRF de R$ 10,00 (999,99 centavos → 1000)', () => {
    expect(conta(PJ_NACIONAL, 666.66).irrf.aplicado).toBe(false)
    expect(conta(PJ_NACIONAL, 666.66, 50).irrf).toMatchObject({ valor: 10, aplicado: true, motivo: { tipo: 'por_acumulacao' } })
  })

  it('motivo "por acumulação" quando o bruto sozinho não chegaria ao mínimo de cálculo', () => {
    const r = conta(PJ_NACIONAL, 660, 100)
    // IRRF: 660 < 666,67 mas 760 ≥; 9,90 < 10 → segura no mínimo de retenção
    expect(r.irrf.aplicado).toBe(false)
    const r2 = { ...conta(PJ_SEM_MINIMO, 660, 100) }
    expect(r2.irrf.valor).toBe(9.9)
    const r3 = calcularImpostosNfse({
      grupo: { ...resolverGrupoImposto(PJ_NACIONAL, 'PJ'), minRet: { irrf: 5, pis: 1.4, cofins: 6.46, csll: 2.15 } },
      valorBruto: 660,
      acumuladoMes: 100,
    })
    expect(r3.irrf).toMatchObject({ valor: 9.9, aplicado: true, motivo: { tipo: 'por_acumulacao', acumulado: 100, bruto: 660, base: 760 } })
  })

  it('"PJ sem mínimo" retém mesmo em nota pequena (NF de R$ 200 da Ibrafer, 07/10)', () => {
    const r = conta(PJ_SEM_MINIMO, 200)
    expect(r.irrf.valor).toBe(3)
    expect(r.pisCofinsCsll).toBe(9.3)
    expect(r.valorLiquido).toBe(187.7)
  })
})

describe('calcularImpostosNfse — grupos', () => {
  it('PF Nacional: sem retenção, líquido = bruto', () => {
    const r = conta(PF_NACIONAL, 4123.77)
    expect(r.totalRetencoes).toBe(0)
    expect(r.valorLiquido).toBe(4123.77)
    expect(r.irrf.motivo).toEqual({ tipo: 'nao_aplica' })
  })

  it('Sem IRRF: só PIS/COFINS/CSLL', () => {
    const r = conta(SEM_IRRF, 1000)
    expect(r.irrf.valor).toBe(0)
    expect(r.pisCofinsCsll).toBe(46.5)
    expect(r.valorLiquido).toBe(953.5)
  })

  it('ISS não retido (tipo_retencao_iss 1, todos os grupos hoje): ISS fora do líquido', () => {
    expect(conta(PJ_NACIONAL, 1000).issRetido).toBe(0)
  })

  it('ISS retido pelo tomador (tipo_retencao_iss 2): sai do líquido, como em finance.valor_liquido_da_nota', () => {
    const r = conta({ ...PJ_NACIONAL, tipo_retencao_iss: 2 }, 1000)
    expect(r.issRetido).toBe(35)
    expect(r.valorLiquido).toBe(1000 - 15 - 46.5 - 35)
  })

  it('grupo sem colunas cai na regra pelo nome; sem nome, pelo tipo do tomador', () => {
    expect(resolverGrupoImposto({ nome: 'IRRF' }, 'PJ').retem).toEqual({ irrf: true, pis: false, cofins: false, csll: false })
    expect(resolverGrupoImposto(null, 'PF').nome).toBe('PF Nacional')
    expect(resolverGrupoImposto({ nome: 'Advocacia Curitiba (NFSe Nacional)' }, 'PJ').nome).toBe('PJ Nacional')
  })
})

describe('por pagador, como a emit-nfse emite', () => {
  const PJ = resolverGrupoImposto(PJ_NACIONAL, 'PJ')

  it('rateio 50/50 de R$ 1.000: cada nota de R$ 500 fica abaixo do mínimo do IRRF', () => {
    const pagadores = pagadoresDaEmissao([], { pagadores: [{ cliente_id: 'a', percentual: 50 }, { cliente_id: 'b', percentual: 50 }], valor_total: 1000 })
    expect(pagadores).toEqual([{ cliente_id: 'a', valor: 500 }, { cliente_id: 'b', valor: 500 }])
    const notas = calcularImpostosPorPagador({ grupo: PJ, pagadores, acumuladoAtual: {}, contratoClienteId: 'x' })
    expect(notas.map((n) => n.impostos.irrf.valor)).toEqual([0, 0])
    expect(notas.map((n) => n.impostos.valorLiquido)).toEqual([476.75, 476.75])
    // A conta antiga da prévia, sobre o total, mostrava IRRF de R$ 15,00.
    expect(calcularImpostosNfse({ grupo: PJ, valorBruto: 1000, acumuladoMes: 0 }).irrf.valor).toBe(15)
  })

  it('NF 2235 + 2236 (FSX e GS, 15/10): a 2ª nota soma a 1ª no acumulado porque GS é o cliente do contrato', () => {
    const GS = 'gs', FSX = 'fsx'
    const pagadores = pagadoresDaEmissao([{ cliente_id: FSX, valor_total: 5409.25 }, { cliente_id: GS, valor_total: 5409.25 }])
    const notas = calcularImpostosPorPagador({ grupo: PJ, pagadores, acumuladoAtual: { [GS]: 0, [FSX]: 0 }, contratoClienteId: GS })
    expect(notas.map((n) => n.acumuladoMes)).toEqual([0, 5409.25])
    for (const n of notas) {
      expect(n.impostos.irrf.valor).toBe(81.14)
      expect(n.impostos.pis.valor).toBe(35.16)
      expect(n.impostos.cofins.valor).toBe(162.28)
      expect(n.impostos.pisCofinsCsll).toBe(251.53)
      expect(n.impostos.valorLiquido).toBe(5076.58)
    }
  })

  it('acumulado do pagador que não é o cliente do contrato não recebe as notas da mesma emissão (Heusy, 14/10)', () => {
    // get_client_month_accumulated_value(Gerson) = 5000: inclui a nota de Edson
    // emitida num contrato de Gerson. Edson, que não é cliente de contrato, 0.
    expect(acumuladosNaEmissao(
      [{ cliente_id: 'gerson', valor: 416.67 }, { cliente_id: 'edson', valor: 416.67 }],
      { gerson: 5000, edson: 0 },
      'gerson',
    )).toEqual([5000, 0])
  })

  it('valor ajustado sem trocar pagadores reescala o rateio', () => {
    expect(pagadoresDaEmissao([{ cliente_id: 'a', valor_total: 600 }, { cliente_id: 'b', valor_total: 400 }], { valor_total: 2000 }))
      .toEqual([{ cliente_id: 'a', valor: 1200 }, { cliente_id: 'b', valor: 800 }])
  })

  it('mês do acumulado é o da emissão em Brasília, não em UTC', () => {
    expect(mesDaEmissao(new Date('2026-10-31T23:30:00Z'))).toBe('2026-10') // 20:30 em Curitiba
    expect(mesDaEmissao(new Date('2026-11-01T02:30:00Z'))).toBe('2026-10') // 23:30 do dia 31
    expect(mesDaEmissao(new Date('2026-11-01T03:05:00Z'))).toBe('2026-11')
  })
})
