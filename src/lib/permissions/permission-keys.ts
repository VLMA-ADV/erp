/**
 * RBAC por permission_key — semântica compartilhada entre UI e documentação (ADR-007).
 * Uma chave é satisfeita se estiver na lista ou for coberta por sufixo `.*` ou pela chave global `*`.
 */
export function isPermissionSatisfied(effectiveKeys: readonly string[], required: string): boolean {
  if (!required || effectiveKeys.length === 0) return false
  if (effectiveKeys.includes('*')) return true
  if (effectiveKeys.includes(required)) return true
  const segments = required.split('.')
  for (let len = segments.length; len > 0; len--) {
    const prefix = segments.slice(0, len).join('.')
    if (effectiveKeys.includes(`${prefix}.*`)) return true
  }
  return false
}
