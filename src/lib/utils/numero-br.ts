/**
 * Lê um número digitado por gente, em qualquer dos formatos que aparecem
 * nas telas: "8310.50", "8.310,50", "8310,50", "100", "100.00".
 *
 * Regra: se tem ponto E vírgula, o ponto é milhar e a vírgula é decimal
 * (pt-BR). Se tem só vírgula, ela é decimal. Se tem só ponto, ele é
 * decimal — e não milhar. Foi esse último caso que quebrou a prévia da
 * NFS-e em 18/09: o campo vinha preenchido com "100.00" e o leitor antigo
 * apagava o ponto e lia 10000.
 */
export function lerNumero(texto: unknown): number {
  const t = String(texto ?? '').trim().replace(/[^\d.,-]/g, '')
  if (!t) return NaN
  const temPonto = t.includes('.')
  const temVirgula = t.includes(',')
  let normalizado = t
  if (temPonto && temVirgula) {
    normalizado = t.replace(/\./g, '').replace(',', '.')
  } else if (temVirgula) {
    normalizado = t.replace(',', '.')
  }
  const n = Number(normalizado)
  return Number.isFinite(n) ? n : NaN
}
