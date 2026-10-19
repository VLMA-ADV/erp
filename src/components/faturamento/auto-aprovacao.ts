// Aprovação automática (out/2026): item de regra projeto (sem parcelas) pode
// nascer aprovado quando a chave do tenant está ligada
// (core.system_settings 'faturamento.autoaprovar_projeto'). O banco marca
// snapshot.auto_aprovado = true; se o valor for alterado depois, o item volta
// para em_revisao e a marca vira false.

export const AUTO_APROVADO_LABEL = 'Aprovado automaticamente'
export const AUTO_APROVADO_ATOR = 'Sistema (automático)'
export const AUTO_APROVADO_TITLE =
  'Regra de cobrança projeto: aprovado pelo sistema ao liberar. Se o valor for alterado, volta para a revisão.'

type ItemComSnapshot = {
  status: string
  snapshot?: Record<string, unknown> | null
}

export function isAutoAprovado(item: ItemComSnapshot): boolean {
  if (item.status !== 'aprovado' && item.status !== 'faturado') return false
  return item.snapshot?.auto_aprovado === true
}
