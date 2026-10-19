import { describe, expect, it } from 'vitest'
import { linhasDoRelatorio } from './linhas-relatorio'
import type { ItemKit, KitCaso, LinhaTimesheet } from './types'
import {
  avisoValorFixo, ehItemDeMensalidade, rotuloMensalidade, valorFixoDoKit, valorFixoParaPdf, valoresDasLinhasValorFixo,
} from './valor-fixo-relatorio'

// Números reais de produção (SELECT em get_composicao_fatura, 18/10/2026);
// nomes trocados.

const linha = (horas: number, extra: Partial<LinhaTimesheet> = {}): LinhaTimesheet => ({
  data: '2026-09-02', profissional: 'Ana Souza', cargo: 'Sócia', descricao: 'Reunião', horas, valor_hora: 0, valor: 0, ...extra,
})

let seq = 0
const itemTs = (horas: number, valor = 0, linhaExtra: Partial<LinhaTimesheet> = {}): ItemKit => ({
  id: `ts-${++seq}`, origem_tipo: 'timesheet', descricao: 'Timesheet', data_referencia: '2026-09-02', horas, valor,
  status: 'faturado', linhas_timesheet: [linha(horas, linhaExtra)], despesa: null,
})

const mensalidade = (regra: string, valor: number, status = 'faturado'): ItemKit => ({
  id: `regra-${++seq}`, origem_tipo: 'regra_financeira', descricao: regra, data_referencia: '2026-10-01', horas: 0, valor,
  status, linhas_timesheet: [], despesa: null,
})

const kit = (extra: Partial<KitCaso>): KitCaso => ({
  chave: 'k', caso_id: 'caso', caso_numero: 1, caso_nome: 'Consultoria', regra_cobranca: 'mensal', contrato_id: 'ct',
  contrato_numero: 1, contrato_nome: 'Contrato', competencia: '2026-10-01', enviar_relatorio_timesheet: true,
  grupo_imposto: null, pagadores: [], valor_servico: 0, valor_despesa: 0, horas: 0, lancamentos_timesheet: 0, valor_total: 0,
  itens: [], documentos: { nfse: null, boleto: null, relatorio_timesheet: null, nota_debito: null, nfses: [] },
  envio: null, conta_receber: null, status_kit: 'pendente', finalizado: null, ajustes_kit: null, pode_excluir: true, motivo_bloqueio: null,
  ...extra,
})

// Caso 63, kit out/2026: 24 lançamentos (26,72h) a R$ 0,00 + mensalidade R$ 4.920 (NFS-e 2132).
const HORAS_63_OUT = [0.5, 0.5, 1, 1.5, 0.5, 0.5, 0.5, 0.5, 0.33, 4, 0.5, 1, 1, 3.75, 0.5, 2.32, 1, 0.5, 1, 0.5, 2.42, 0.4, 1, 1]
// Caso 63, kit set/2026: 20 lançamentos (25,48h) aprovados; a mensalidade ainda em revisão (fora do kit).
const HORAS_63_SET = [0.75, 2, 0.5, 0.75, 0.33, 3, 1, 0.5, 3.02, 0.42, 1, 1.62, 4.75, 0.5, 2, 0.5, 0.67, 0.67, 1, 0.5]

describe('valorFixoDoKit', () => {
  it('kit mensal sem excedente (caso 63, out/2026): mensalidade do mês do serviço, linhas sem valor', () => {
    const k = kit({
      caso_numero: 63, valor_servico: 4920,
      itens: [mensalidade('mensal', 4920), ...HORAS_63_OUT.map((h) => itemTs(h))],
    })
    const fixo = valorFixoDoKit(k)
    expect(fixo).toMatchObject({ situacao: 'no_kit', regra: 'mensal', rotulo: 'Mensalidade setembro/2026', valor: 4920 })
    expect(valorFixoParaPdf(fixo!)).toEqual({ rotulo: 'Mensalidade setembro/2026', valor: 4920 })
    expect(avisoValorFixo(fixo!)).toBeNull()
    const valores = valoresDasLinhasValorFixo(linhasDoRelatorio(k.itens).visiveis)
    expect(valores).toHaveLength(24)
    expect(valores.every((v) => v === null)).toBe(true)
  })

  it('mensalidade com teto (caso 314: 15h, excedente R$ 343,54/h) usa o valor do ITEM, não o da linha', () => {
    // Out/2026 real: 2,58h, todas dentro do teto → nada de excedente.
    const real = kit({
      caso_numero: 314, valor_servico: 5366.55,
      itens: [mensalidade('mensal', 5366.55), itemTs(0.75), itemTs(0.33), itemTs(0.17), itemTs(1.33)],
    })
    expect(valorFixoDoKit(real)).toMatchObject({ situacao: 'no_kit', valor: 5366.55 })
    expect(valoresDasLinhasValorFixo(linhasDoRelatorio(real.itens).visiveis)).toEqual([null, null, null, null])

    // Mesmo caso com 16,5h no mês (sintético; produção não tem kit acima do
    // teto): o lançamento que cruza o teto cobra só 1,5h × 343,54 = R$ 515,31.
    // A linha da RPC ainda traz o valor_hora antigo da revisão (535,66) — o
    // que aconteceu de fato no kit de set/2026 do caso 314.
    const linhaAntiga = { valor_hora: 535.66, valor: 1339.15 }
    const comExcedente = kit({
      caso_numero: 314, valor_servico: 5881.86,
      itens: [mensalidade('mensal', 5366.55), itemTs(8, 0, { valor_hora: 535.66, valor: 4285.28 }), itemTs(6, 0, { valor_hora: 535.66, valor: 3213.96 }), itemTs(2.5, 515.31, linhaAntiga)],
    })
    const valores = valoresDasLinhasValorFixo(linhasDoRelatorio(comExcedente.itens).visiveis)
    expect(valores).toEqual([null, null, 515.31])
    expect((valorFixoDoKit(comExcedente) as { valor: number }).valor + 515.31).toBeCloseTo(5881.86, 2)
  })

  it('item com mais de uma linha: reparte o valor do item pelas horas, último absorve os centavos', () => {
    const item: ItemKit = { ...itemTs(3, 100), linhas_timesheet: [linha(1), linha(1), linha(1)] }
    expect(valoresDasLinhasValorFixo(linhasDoRelatorio([item]).visiveis)).toEqual([33.33, 33.33, 33.34])
  })

  it('mensal sem o item de mensalidade no kit (caso 63, set/2026): não inventa valor, avisa', () => {
    const k = kit({ caso_numero: 63, competencia: '2026-09-01', itens: HORAS_63_SET.map((h) => itemTs(h)) })
    const fixo = valorFixoDoKit(k)
    expect(fixo).toEqual({ situacao: 'fora_do_kit', regra: 'mensal', rotulo: 'Mensalidade agosto/2026' })
    expect(valorFixoParaPdf(fixo!)).toEqual({ rotulo: 'Mensalidade agosto/2026', valor: null, observacao: 'não incluída neste kit' })
    expect(avisoValorFixo(fixo!)).toMatch(/^Mensalidade agosto\/2026 não está neste kit/)
  })

  it('carteira: a mensalidade lançada em outro caso do contrato (1261) é citada no kit das horas (1866)', () => {
    const principal = kit({ chave: 'k1261', caso_numero: 1261, regra_cobranca: 'mensalidade_carteira', valor_servico: 6500, itens: [mensalidade('mensalidade_carteira', 6500)] })
    const horas = kit({ chave: 'k1866', caso_numero: 1866, regra_cobranca: 'mensalidade_carteira', itens: [itemTs(1), itemTs(0.67)] })
    const outroContrato = kit({ chave: 'kx', contrato_id: 'outro', caso_numero: 9, regra_cobranca: 'mensalidade_carteira', itens: [mensalidade('mensalidade_carteira', 1)] })
    const fixo = valorFixoDoKit(horas, [outroContrato, principal, horas])
    expect(fixo).toMatchObject({ situacao: 'outro_caso', casoNumero: 1261, rotulo: 'Mensalidade setembro/2026' })
    expect(valorFixoParaPdf(fixo!)).toEqual({
      rotulo: 'Mensalidade setembro/2026', valor: null, observacao: 'mensalidade da carteira, cobrada no caso #1261',
    })
    expect(avisoValorFixo(fixo!)).toMatch(/caso #1261/)
    // O próprio 1261 é kit de valor fixo normal.
    expect(valorFixoDoKit(principal, [principal, horas])).toMatchObject({ situacao: 'no_kit', valor: 6500 })
  })

  it('pró-labore (caso 1928), projeto, mensalidade de processo e hora não são valor fixo', () => {
    for (const regra of ['pro_labore', 'projeto', 'mensalidade_processo', 'salario_minimo', 'hora', null]) {
      expect(valorFixoDoKit(kit({ caso_numero: 1928, regra_cobranca: regra, itens: [itemTs(3), itemTs(7.5)] }))).toBeNull()
    }
    // Item de projeto num caso mensal (caso 349: mensalidade + parcela) não entra no fixo.
    const misto = kit({ itens: [mensalidade('mensal', 3500), mensalidade('projeto', 51708.76), itemTs(1)] })
    expect(valorFixoDoKit(misto)).toMatchObject({ situacao: 'no_kit', valor: 3500 })
  })

  it('reconhece o item pela regra e ignora item cancelado/ignorado', () => {
    expect(ehItemDeMensalidade(mensalidade('mensal', 1))).toBe(true)
    expect(ehItemDeMensalidade(mensalidade('mensalidade_carteira', 1))).toBe(true)
    expect(ehItemDeMensalidade(mensalidade('pro_labore', 1))).toBe(false)
    expect(ehItemDeMensalidade(mensalidade('mensal', 1, 'ignorado'))).toBe(false)
    expect(ehItemDeMensalidade({ ...itemTs(1), descricao: 'mensal' })).toBe(false)
  })

  it('rótulo usa o mês do serviço (kit − 1) e vira o ano', () => {
    expect(rotuloMensalidade('2026-10-01', 'mensal')).toBe('Mensalidade setembro/2026')
    expect(rotuloMensalidade('2027-01-01', 'mensalidade_carteira')).toBe('Mensalidade dezembro/2026')
  })
})
