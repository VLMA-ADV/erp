// Nº do documento (cliente, out/2026): "uma numeração única onde podemos
// localizar depois o arquivo". Um contador por escritório para relatório de
// timesheet, nota de débito e NFS-e (finance.billing_notes.numero_documento,
// migration 20261018100000). Aqui, só o que as telas precisam para achar um
// documento pelo número.

/**
 * "15", "nº 15", "n. 15", "Nº15", "#15", "doc 15", "documento nº 15" → 15.
 * Qualquer outra coisa (nome de cliente, "15 abc") → null. Mesma regra da
 * busca de get_notas_geradas.
 */
export function numeroDocumentoDaBusca(termo: string | null | undefined): number | null {
  const m = /^\s*(?:(?:documento|doc\.?)\s*)?(?:n[º°o]?\.?\s*|#\s*)?(\d+)\s*$/i.exec(String(termo ?? ''))
  if (!m) return null
  const n = Number(m[1])
  return Number.isSafeInteger(n) && n > 0 ? n : null
}

interface ComNumero { numero_documento?: number | null }

interface DocumentosComNumero {
  documentos: {
    nfse?: ComNumero | null
    nfses?: ComNumero[] | null
    relatorio_timesheet?: ComNumero | null
    nota_debito?: ComNumero | null
  }
}

/** Todos os nºs de documento de um kit (NFS-e de cada pagador, relatório, ND). */
export function numerosDocumentoDoKit(kit: DocumentosComNumero): number[] {
  const d = kit.documentos
  const todos = [d.nfse, ...(d.nfses ?? []), d.relatorio_timesheet, d.nota_debito]
    .map((doc) => doc?.numero_documento)
    .filter((n): n is number => typeof n === 'number' && n > 0)
  return Array.from(new Set(todos)).sort((a, b) => a - b)
}

/** O kit tem o documento procurado pelo número? */
export function kitTemNumeroDocumento(kit: DocumentosComNumero, termo: string): boolean {
  const n = numeroDocumentoDaBusca(termo)
  return n != null && numerosDocumentoDoKit(kit).includes(n)
}
