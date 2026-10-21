// Duração do lançamento de horas em frações de 5 minutos (pedido do cliente, out/2026).
//
// Regra: toda duração NOVA precisa ser múltipla de 5 min (5, 10, 15, ...).
// Lançamentos antigos com duração fora da fração (ex. 12 min) continuam
// editáveis enquanto a duração não muda — a regra vale para a duração que a
// pessoa digita, não para o que já está gravado. O servidor (create_timesheet /
// update_timesheet) aplica a mesma regra.

export const FRACAO_MINUTOS = 5

export const TEXTO_FRACAO = 'A fração só pode ser de 5 em 5 minutos.'

export type ResultadoDuracao = { ok: true } | { ok: false; mensagem: string }

export function ehFracaoValida(minutos: number) {
  return Number.isInteger(minutos) && minutos % FRACAO_MINUTOS === 0
}

/**
 * Valida a duração total (em minutos) do formulário.
 * `original` é a duração gravada do lançamento em edição (null/undefined no novo).
 */
export function validarDuracao(minutos: number, original?: number | null): ResultadoDuracao {
  if (!Number.isFinite(minutos) || minutos <= 0) {
    return { ok: false, mensagem: 'Informe a duração do lançamento (horas e/ou minutos)' }
  }
  if (original != null && minutos === original) return { ok: true }
  if (!ehFracaoValida(minutos)) {
    return { ok: false, mensagem: `Duração de ${minutos} min não é aceita. ${TEXTO_FRACAO}` }
  }
  return { ok: true }
}
