import { describe, expect, it } from 'vitest'
import { gruposParaRelatorioConsolidado, kitEntraNoConsolidado, ordemDoRegistro } from './relatorio-consolidado'
import type { ItemKit, KitCaso } from './types'

const itemTs = (horas: number, extra: Partial<ItemKit> = {}): ItemKit => ({
  id: `ts-${horas}`, origem_tipo: 'timesheet', descricao: 'Timesheet', data_referencia: '2026-09-03', horas, valor: 0,
  status: 'aprovado', despesa: null,
  linhas_timesheet: [{ data: '2026-09-03', profissional: 'Ana', cargo: null, descricao: 'Reunião', horas, valor_hora: 0, valor: 0 }],
  ...extra,
})
const mensalidade: ItemKit = {
  id: 'm', origem_tipo: 'regra_financeira', descricao: 'mensal', data_referencia: '2026-10-01', horas: 0, valor: 3454.35,
  status: 'faturado', despesa: null, linhas_timesheet: [],
}
const despesa: ItemKit = {
  id: 'd', origem_tipo: 'despesa', descricao: 'Cartório', data_referencia: '2026-10-01', horas: 0, valor: 2364.6,
  status: 'faturado', despesa: null, linhas_timesheet: [],
}

const kit = (n: number, extra: Partial<KitCaso> = {}): KitCaso => ({
  chave: `k${n}`, caso_id: `caso-${n}`, caso_numero: n, caso_nome: `Caso ${n}`, regra_cobranca: 'hora', contrato_id: 'ct',
  contrato_numero: 482, contrato_nome: 'Pattac', competencia: '2026-10-01', enviar_relatorio_timesheet: false,
  grupo_imposto: null, pagadores: [], valor_servico: 0, valor_despesa: 0, horas: 0, lancamentos_timesheet: 0, valor_total: 0,
  itens: [itemTs(1)], documentos: { nfse: null, boleto: null, relatorio_timesheet: null, nota_debito: null, nfses: [] },
  envio: null, conta_receber: null, status_kit: 'pendente', finalizado: null, ajustes_kit: null, pode_excluir: true, motivo_bloqueio: null,
  ...extra,
})

describe('relatório consolidado por contrato', () => {
  it('Pattac out/2026: os casos com horas entram; o de só despesa (414) fica de fora', () => {
    const kits = [kit(1911), kit(414, { itens: [despesa] }), kit(337), kit(1984), kit(1946), kit(1917)]
    const grupos = gruposParaRelatorioConsolidado(kits)
    expect(grupos).toHaveLength(1)
    expect(grupos[0].map((k) => k.caso_numero)).toEqual([337, 1911, 1917, 1946, 1984])
  })

  it('Jamute: o caso da mensalidade entra mesmo sem hora visível', () => {
    const k365 = kit(365, { regra_cobranca: 'mensal', itens: [mensalidade, itemTs(0)] })
    expect(kitEntraNoConsolidado(k365)).toBe(true)
    expect(gruposParaRelatorioConsolidado([kit(1828), k365]).map((g) => g.map((k) => k.caso_numero))).toEqual([[365, 1828]])
  })

  it('um kit só, contratos ou competências diferentes: não há grupo', () => {
    expect(gruposParaRelatorioConsolidado([kit(337)])).toEqual([])
    expect(gruposParaRelatorioConsolidado([kit(337), kit(1911, { contrato_id: 'outro' })])).toEqual([])
    expect(gruposParaRelatorioConsolidado([kit(337), kit(1911, { competencia: '2026-09-01' })])).toEqual([])
  })

  it('a via principal é o primeiro caso que envia relatório; nenhum enviando, o primeiro caso', () => {
    const kits = [kit(1911, { enviar_relatorio_timesheet: true }), kit(337), kit(1946, { enviar_relatorio_timesheet: true })]
    expect(ordemDoRegistro(kits).map((k) => k.caso_numero)).toEqual([1911, 337, 1946])
    expect(ordemDoRegistro([kit(1911), kit(337)]).map((k) => k.caso_numero)).toEqual([337, 1911])
  })
})
