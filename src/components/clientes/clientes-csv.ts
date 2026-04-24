export interface CsvRow {
  nome: string
  cnpj: string
}

export interface CsvParseResult {
  rows: CsvRow[]
  errors: string[]
}

function splitCsvLine(line: string) {
  const values: string[] = []
  let current = ''
  let inQuotes = false

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    const nextChar = line[index + 1]

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"'
        index += 1
        continue
      }

      inQuotes = !inQuotes
      continue
    }

    if (!inQuotes && (char === ',' || char === ';' || char === '\t')) {
      values.push(current.trim())
      current = ''
      continue
    }

    current += char
  }

  values.push(current.trim())
  return values.map((value) => value.replace(/^"|"$/g, '').trim())
}

export function normalizeDocumento(value: string) {
  return value.replace(/\D/g, '')
}

export function parseClientesCsv(text: string): CsvParseResult {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  if (lines.length < 2) {
    return { rows: [], errors: ['O arquivo precisa conter cabeçalho e pelo menos uma linha de dados.'] }
  }

  const header = splitCsvLine(lines[0]).map((column) => column.toLowerCase())
  const nomeIdx = header.findIndex((column) =>
    ['nome', 'nome do cliente', 'razao_social', 'razao social', 'nome/razão social'].includes(column),
  )
  const cnpjIdx = header.findIndex((column) =>
    ['cnpj', 'cnpj/cpf', 'cpf/cnpj', 'cpf_cnpj', 'documento'].includes(column),
  )

  if (nomeIdx === -1 || cnpjIdx === -1) {
    return {
      rows: [],
      errors: ['Cabeçalho inválido. Use pelo menos as colunas "nome" e "cnpj".'],
    }
  }

  const rows: CsvRow[] = []
  const errors: string[] = []

  for (let index = 1; index < lines.length; index += 1) {
    const columns = splitCsvLine(lines[index])
    const nome = columns[nomeIdx]?.trim() || ''
    const cnpj = normalizeDocumento(columns[cnpjIdx] || '')

    if (!nome && !cnpj) continue

    if (!nome || !cnpj) {
      errors.push(`Linha ${index + 1}: nome e CNPJ são obrigatórios.`)
      continue
    }

    rows.push({ nome, cnpj })
  }

  return { rows, errors }
}
