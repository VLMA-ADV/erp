import { describe, expect, it } from 'vitest'
import { isPermissionSatisfied } from './permission-keys'

describe('isPermissionSatisfied (ADR-007 / RBAC)', () => {
  it('retorna false para lista vazia ou chave vazia', () => {
    expect(isPermissionSatisfied([], 'operations.timesheet.read')).toBe(false)
    expect(isPermissionSatisfied(['operations.timesheet.read'], '')).toBe(false)
  })

  it('aceita correspondência exata', () => {
    expect(isPermissionSatisfied(['operations.timesheet.read'], 'operations.timesheet.read')).toBe(true)
  })

  it('aceita curinga global *', () => {
    expect(isPermissionSatisfied(['*'], 'contracts.contratos.write')).toBe(true)
  })

  it('aceita prefixo.* mais específico antes do genérico', () => {
    expect(isPermissionSatisfied(['operations.despesas.*'], 'operations.despesas.read')).toBe(true)
    expect(isPermissionSatisfied(['operations.*'], 'operations.despesas.read')).toBe(true)
    expect(isPermissionSatisfied(['operations.*'], 'operations.timesheet.write')).toBe(true)
  })

  it('não concede chave de outro domínio', () => {
    expect(isPermissionSatisfied(['crm.*'], 'operations.timesheet.read')).toBe(false)
  })

  it('write não implica read (ações distintas)', () => {
    expect(isPermissionSatisfied(['crm.pipeline.write'], 'crm.pipeline.read')).toBe(false)
  })

  it('people.pdi.* cobre people.pdi.read mas não people.colaboradores.view_pdi', () => {
    expect(isPermissionSatisfied(['people.pdi.*'], 'people.pdi.read')).toBe(true)
    expect(isPermissionSatisfied(['people.pdi.*'], 'people.colaboradores.view_pdi')).toBe(false)
  })
})
