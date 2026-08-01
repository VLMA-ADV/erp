/**
 * Horas sempre em "1h 20min" — nunca decimal.
 *
 * Pedido do cliente (01/08): "0,33 h" e "23min" conviviam na mesma tela e
 * confundiam quem revisa. Advogado pensa em hora e minuto, não em fração.
 */
export function formatHorasMin(value: number | string | null | undefined): string {
  const total = Number(value || 0)
  if (!Number.isFinite(total) || total === 0) return '0h'

  const negativo = total < 0
  const totalMin = Math.round(Math.abs(total) * 60)
  const h = Math.floor(totalMin / 60)
  const min = totalMin % 60

  const texto = h === 0 ? `${min}min` : min > 0 ? `${h}h ${min}min` : `${h}h`
  return negativo ? `-${texto}` : texto
}
