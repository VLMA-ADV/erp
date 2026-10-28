import { describe, expect, it } from 'vitest'
import { etapasDoKit, pagadoresDoRateioDespesas, type DocNotaDebitoPagador, type KitCaso } from './types'

const kit = (extra: Partial<KitCaso> = {}): KitCaso => ({
  chave: 'k', caso_id: 'caso', caso_numero: 342, caso_nome: 'Caso', regra_cobranca: 'hora', contrato_id: 'ct',
  contrato_numero: 1, contrato_nome: 'Contrato', competencia: '2026-10-01', enviar_relatorio_timesheet: false,
  grupo_imposto: null, valor_servico: 0, valor_despesa: 9.65, horas: 0, lancamentos_timesheet: 0, valor_total: 9.65,
  pagadores: [{ cliente_id: 'a', nome: 'A', percentual: 50 }, { cliente_id: 'b', nome: 'B', percentual: 50 }],
  itens: [], documentos: { nfse: null, boleto: null, relatorio_timesheet: null, nota_debito: null, nfses: [] },
  envio: null, conta_receber: null, status_kit: 'pendente', finalizado: null, ajustes_kit: null, pode_excluir: true, motivo_bloqueio: null,
  boleto_base: null,
  ...extra,
})

const nd = (id: string, boleto: DocNotaDebitoPagador['boleto']): DocNotaDebitoPagador => ({
  id, numero_documento: 1, arquivo_url: 'x', gerado_em: null, percentual: 50, valor: 4.83,
  pagador: { cliente_id: id, nome: id }, conta_receber: null, boleto,
})

describe('rateio das despesas entre pagadores (Filipe 29/10)', () => {
  it('kit só de despesas com dois pagadores divide a nota de débito', () => {
    expect(pagadoresDoRateioDespesas(kit())?.map((p) => p.cliente_id)).toEqual(['a', 'b'])
  })

  it('não divide: kit com honorários, um pagador só ou RPC antiga (sem boleto_base)', () => {
    expect(pagadoresDoRateioDespesas(kit({ valor_servico: 1000 }))).toBeNull()
    expect(pagadoresDoRateioDespesas(kit({ pagadores: [{ cliente_id: 'a', nome: 'A', percentual: 100 }] }))).toBeNull()
    expect(pagadoresDoRateioDespesas(kit({ boleto_base: undefined }))).toBeNull()
  })

  it('o boleto do kit só está feito quando todas as notas de débito têm o seu', () => {
    const boleto = { id: 'b1', status: 'registrado', vencimento: '2026-11-15', valor: 4.83, linha_digitavel: null, nosso_numero: '1', pix_emv: null }
    const docs = (nds: DocNotaDebitoPagador[]) => ({ nfse: null, boleto: null, relatorio_timesheet: null, nota_debito: null, nfses: [], notas_debito: nds })
    const etapa = (k: KitCaso) => etapasDoKit(k).find((e) => e.rotulo === 'Boleto')!.emitida
    expect(etapa(kit({ documentos: docs([nd('a', boleto), nd('b', null)]) }))).toBe(false)
    expect(etapa(kit({ documentos: docs([nd('a', boleto), nd('b', { ...boleto, id: 'b2' })]) }))).toBe(true)
  })
})
