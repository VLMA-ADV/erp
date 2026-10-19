import { describe, expect, it } from 'vitest'
import { competenciaDoServico, competenciaDoServicoDosItens } from './competencia-do-servico'

describe('competenciaDoServico', () => {
  it('horas e despesas: mês anterior ao da competência do kit', () => {
    expect(competenciaDoServico('2026-10-01', 'timesheet')).toBe('2026-09-01')
    expect(competenciaDoServico('2026-10-01', 'despesa')).toBe('2026-09-01')
  })

  it('vira o ano em janeiro', () => {
    expect(competenciaDoServico('2027-01-01', 'timesheet')).toBe('2026-12-01')
  })

  it('mensalidade (mensal e de carteira) também mostra o mês anterior — o mês do serviço', () => {
    expect(competenciaDoServico('2026-10-01', 'mensal')).toBe('2026-09-01')
    expect(competenciaDoServico('2026-10-01', 'mensalidade_carteira')).toBe('2026-09-01')
    expect(competenciaDoServico('2027-01-01', 'mensal')).toBe('2026-12-01')
  })

  it('projeto, pró-labore e demais regras ficam no próprio mês', () => {
    for (const regra of ['regra', 'regra_financeira', 'mensalidade_processo', 'projeto', 'pro_labore', 'salario_minimo', 'exito']) {
      expect(competenciaDoServico('2026-10-01', regra)).toBe('2026-10-01')
    }
  })

  it('aceita YYYY-MM e data completa; inválido volta como veio', () => {
    expect(competenciaDoServico('2026-10', 'timesheet')).toBe('2026-09-01')
    expect(competenciaDoServico('2026-10-15', 'despesa')).toBe('2026-09-01')
    expect(competenciaDoServico('', 'timesheet')).toBe('')
    expect(competenciaDoServico('outubro', 'timesheet')).toBe('outubro')
  })
})

describe('competenciaDoServicoDosItens', () => {
  it('kit que mistura horas e mensalidade mostra o mês das horas', () => {
    expect(competenciaDoServicoDosItens('2026-10-01', ['regra', 'timesheet'])).toBe('2026-09-01')
  })

  it('só mensalidade: mês anterior', () => {
    expect(competenciaDoServicoDosItens('2026-10-01', ['mensal'])).toBe('2026-09-01')
  })

  it('só regra: próprio mês; vazio: próprio mês', () => {
    expect(competenciaDoServicoDosItens('2026-10-01', ['regra'])).toBe('2026-10-01')
    expect(competenciaDoServicoDosItens('2026-10-01', ['projeto', 'pro_labore'])).toBe('2026-10-01')
    expect(competenciaDoServicoDosItens('2026-10-01', [])).toBe('2026-10-01')
  })
})
