import { describe, expect, it } from 'vitest'
import { LIMITE_DISCRIMINACAO_NFSE, linhaCompetenciaDaNota, montarDiscriminacao, naturezaDoItem } from './discriminacao-nfse'

describe('linha "Competência do serviço" da NFS-e', () => {
  it('horas e mensalidade do kit de outubro = setembro', () => {
    expect(linhaCompetenciaDaNota('2026-10-01', [{ origem: 'timesheet', timesheet_horas: 1 }])).toBe('Competência do serviço: setembro/2026')
    expect(linhaCompetenciaDaNota('2026-10-01', [{ origem: 'regra_financeira', regra_cobranca: 'mensal' }])).toBe('Competência do serviço: setembro/2026')
    expect(linhaCompetenciaDaNota('2026-10-01', [{ origem: 'regra_financeira', regra_cobranca: 'mensalidade_carteira' }])).toBe('Competência do serviço: setembro/2026')
  })

  it('projeto, pró-labore, êxito: o próprio mês', () => {
    expect(linhaCompetenciaDaNota('2026-10-01', [{ origem: 'regra_financeira', regra_cobranca: 'projeto' }])).toBe('Competência do serviço: outubro/2026')
    expect(linhaCompetenciaDaNota('2026-10', [{ origem: 'regra_financeira', regra_cobranca: 'pro_labore' }, { origem: 'regra_financeira', regra_cobranca: 'exito' }])).toBe('Competência do serviço: outubro/2026')
  })

  it('nota misturada usa o mês das horas/mensalidade', () => {
    expect(linhaCompetenciaDaNota('2026-10-01', [{ origem: 'regra_financeira', regra_cobranca: 'projeto' }, { origem: 'timesheet' }])).toBe('Competência do serviço: setembro/2026')
  })

  it('virada de ano e sem competência do kit', () => {
    expect(linhaCompetenciaDaNota('2027-01-01', [{ origem: 'timesheet' }])).toBe('Competência do serviço: dezembro/2026')
    expect(linhaCompetenciaDaNota(null, [{ origem: 'timesheet' }])).toBeNull()
  })

  it('natureza: snapshot antigo sem origem com campos de timesheet é hora', () => {
    expect(naturezaDoItem({ timesheet_horas: 2 })).toBe('timesheet')
    expect(naturezaDoItem(null)).toBe('regra')
  })
})

describe('montarDiscriminacao', () => {
  const FIXA = 'Honorários Advocatícios\nPagamento conforme boleto bancário em anexo'
  it('caso, competência e bloco fixo, nesta ordem', () => {
    expect(montarDiscriminacao({ casoNomes: ['A', 'B'], linhaCompetencia: 'Competência do serviço: setembro/2026', descricaoFixa: FIXA }))
      .toBe('A; B\nCompetência do serviço: setembro/2026\n' + FIXA)
  })
  it('respeita o limite encurtando só os nomes dos casos', () => {
    const t = montarDiscriminacao({ casoNomes: Array.from({ length: 300 }, (_, i) => `Caso ${i}`), linhaCompetencia: 'Competência do serviço: setembro/2026', descricaoFixa: FIXA })
    expect(t.length).toBeLessThanOrEqual(LIMITE_DISCRIMINACAO_NFSE)
    expect(t.endsWith('\nCompetência do serviço: setembro/2026\n' + FIXA)).toBe(true)
    expect(t.split('\n')[0].endsWith('…')).toBe(true)
  })
})
