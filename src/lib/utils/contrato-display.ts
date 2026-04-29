/**
 * Helper canônico de display de contrato.
 *
 * Item 5 (Filipe daily 28/04): uniformizar exibição de contratos.
 * Antes: algumas telas mostravam "Contrato N" (sequencial), outras
 * "Tijuca-2024" (nome_contrato), criando inconsistência. Decisão CA-4(b):
 * "Contrato 25 — Tijuca-2024" — identificador principal sequencial +
 * sub-text discreto com nome_contrato quando útil.
 *
 * Suprime sub-text quando `nome_contrato == "Contrato N"` (gerado pelo
 * backfill RF-064) pra evitar redundância "Contrato 25 — Contrato 25".
 */

export interface ContratoDisplayResult {
  /** "Contrato N" quando há numero_sequencial; senão nome_contrato; senão fallback. */
  primary: string
  /** Sub-text discreto (nome_contrato), null quando redundante ou suprimido. */
  secondary: string | null
  /** Concatenação canônica "Contrato N — nome_contrato" pra usar como string única. */
  full: string
}

export interface ContratoDisplayOptions {
  /** Se true, secondary sempre null (uso em breadcrumb e contextos curtos). */
  suppressSecondary?: boolean
  /** Texto quando não há numero_sequencial nem nome_contrato. Default: "Contrato sem identificador". */
  fallback?: string
}

/**
 * @param numeroSequencial — preferência canônica (`contracts.contratos.numero_sequencial`, RF-064).
 * @param nomeContrato — preserva contexto histórico de contratos antigos alfanuméricos.
 */
export function formatContratoDisplay(
  numeroSequencial: number | null | undefined,
  nomeContrato: string | null | undefined,
  options: ContratoDisplayOptions = {},
): ContratoDisplayResult {
  const { suppressSecondary = false, fallback = 'Contrato sem identificador' } = options

  const seq =
    typeof numeroSequencial === 'number' && Number.isFinite(numeroSequencial) && numeroSequencial > 0
      ? numeroSequencial
      : null
  const nome = String(nomeContrato || '').trim()

  if (seq !== null) {
    const primary = `Contrato ${seq}`
    // Secondary é redundante quando nome bate com primary (backfill RF-064 setou
    // nome_contrato = "Contrato N") ou quando nome está vazio.
    const isRedundant = nome === '' || nome === primary
    const secondary = !suppressSecondary && !isRedundant ? nome : null
    return {
      primary,
      secondary,
      full: secondary ? `${primary} — ${secondary}` : primary,
    }
  }

  // Sem sequencial — usa nome_contrato como fallback final.
  if (nome) {
    return {
      primary: nome,
      secondary: null,
      full: nome,
    }
  }

  return {
    primary: fallback,
    secondary: null,
    full: fallback,
  }
}
