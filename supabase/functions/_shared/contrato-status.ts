export type ContratoFormStatus = 'rascunho' | 'solicitacao' | 'em_analise' | 'ativo' | 'encerrado'
export type ContratoWriteStatus = 'rascunho' | 'validacao' | 'ativo' | 'encerrado'
export type ContratoToggleStatus = 'em_analise' | 'ativo' | 'encerrado'

export function normalizeContratoStatusForForm(status?: string): ContratoFormStatus {
  if (status === 'validacao') return 'em_analise'
  if (status === 'rascunho' || status === 'solicitacao' || status === 'em_analise' || status === 'ativo' || status === 'encerrado') {
    return status
  }
  return 'rascunho'
}

export function formatContratoStatusLabel(status?: string) {
  const normalized = normalizeContratoStatusForForm(status)
  if (normalized === 'solicitacao') return 'solicitação'
  if (normalized === 'em_analise') return 'validação'
  return normalized
}

export function normalizeContratoStatusForWrite(status?: string): ContratoWriteStatus | undefined {
  if (!status) return undefined
  if (status === 'solicitacao') return 'rascunho'
  if (status === 'em_analise') return 'validacao'
  if (status === 'rascunho' || status === 'validacao' || status === 'ativo' || status === 'encerrado') {
    return status
  }
  return undefined
}

export function normalizeContratoStatusForToggle(status?: string): ContratoToggleStatus | undefined {
  if (!status) return undefined
  if (status === 'validacao' || status === 'em_analise') return 'em_analise'
  if (status === 'ativo' || status === 'encerrado') return status
  return undefined
}
