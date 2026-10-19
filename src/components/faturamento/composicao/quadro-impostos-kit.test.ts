import { describe, expect, it } from 'vitest'
import { parametrosQuadroImpostos, quadroImpostosDoKit } from './quadro-impostos-kit'
import type { KitCaso } from './types'

const kitBase = (extra: Partial<KitCaso> = {}): KitCaso => ({
  chave: 'k', caso_id: 'caso', caso_numero: 1901, caso_nome: 'Reestruturação', regra_cobranca: 'hora', contrato_id: 'ct',
  contrato_numero: 650, contrato_nome: 'Societário', competencia: '2026-10-01', enviar_relatorio_timesheet: true,
  grupo_imposto: { id: 'g-pj', nome: 'PJ Nacional' },
  pagadores: [
    { cliente_id: 'fsx', nome: 'FSX Participações', percentual: 50 },
    { cliente_id: 'gs', nome: 'GS Participações LTDA', percentual: 50 },
  ],
  valor_servico: 10818.5, valor_despesa: 0, horas: 16, lancamentos_timesheet: 8, valor_total: 10818.5, itens: [],
  documentos: {
    nfse: null, boleto: null, relatorio_timesheet: null, nota_debito: null,
    nfses: [{
      id: 'nota-fsx', numero: 1, nfse_numero: '2235', status: 'gerado', focus_status: 'autorizado', arquivo_url: null,
      valor_total: 5409.25, pagador: { cliente_id: 'fsx', nome: 'FSX Participações' }, conta_receber: null, boleto: null,
    }],
  },
  envio: null, conta_receber: null, status_kit: 'nfse_emitida' as KitCaso['status_kit'], finalizado: null, ajustes_kit: null,
  pode_excluir: false, motivo_bloqueio: null,
  ...extra,
})

describe('quadro de impostos do kit', () => {
  it('pede à RPC a nota emitida e só o acumulado de quem ainda não tem nota', () => {
    expect(parametrosQuadroImpostos(kitBase())).toEqual({ p_grupo_id: 'g-pj', p_nota_ids: ['nota-fsx'], p_cliente_ids: ['gs'] })
  })

  it('monta real + estimado com a resposta da RPC', () => {
    const q = quadroImpostosDoKit(kitBase(), {
      grupo: {
        id: 'g-pj', nome: 'PJ Nacional', retem_irrf: true, retem_pis: true, retem_cofins: true, retem_csll: true, respeita_minimo: true,
        aliquota_irrf: 1.5, aliquota_pis: 0.65, aliquota_cofins: 3, aliquota_csll: 1, tipo_retencao_iss: 1,
      },
      acumulados: { gs: 10818.5 },
      notas: [{
        nota_id: 'nota-fsx', pagador_cliente_id: 'fsx', pagador_nome: 'FSX Participações', nfse_numero: '2235',
        valor_total: 5409.25, valor_irrf: 81.14, valor_pis: 35.16, valor_cofins: 162.28, valor_pis_cofins_csll: 251.53,
        valor_inss: 0, valor_iss_retido: 0, valor_liquido: 5076.58,
      }],
    }, { contratoClienteId: 'gs', nomePadrao: 'GS Participações LTDA' })
    expect(q?.grupoNome).toBe('PJ Nacional')
    expect(q?.linhas.map((l) => [l.origem, l.liquido])).toEqual([['emitida', 5076.58], ['estimado', 5076.58]])
  })

  it('kit sem serviço e sem nota: sem quadro', () => {
    const kit = kitBase({ valor_servico: 0, documentos: { nfse: null, boleto: null, relatorio_timesheet: null, nota_debito: null, nfses: [] } })
    expect(quadroImpostosDoKit(kit, { grupo: null, acumulados: {}, notas: [] }, { contratoClienteId: null, nomePadrao: 'C' })).toBeNull()
  })
})
