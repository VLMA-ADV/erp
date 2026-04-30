export interface ProcessoCarteira {
  numero_processo: string
  identificador: string
}

export interface ProcessoCarteiraInvalido {
  linha: number
  motivo: string
}

export interface ParseCarteiraResult {
  validas: ProcessoCarteira[]
  invalidas: ProcessoCarteiraInvalido[]
}

const HEADERS_NUMERO = new Set(['numero_processo', 'numero', 'processo', 'numero do processo'])
const HEADERS_IDENTIFICADOR = new Set(['identificador', 'identificacao', 'identificação', 'nome', 'descricao', 'descrição'])

function stripBom(input: string): string {
  return input.charCodeAt(0) === 0xfeff ? input.slice(1) : input
}

function detectSeparator(headerLine: string): ',' | ';' {
  const semi = (headerLine.match(/;/g) || []).length
  const comma = (headerLine.match(/,/g) || []).length
  return semi > comma ? ';' : ','
}

function splitCsvLine(line: string, sep: ',' | ';'): string[] {
  const out: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
      continue
    }
    if (ch === sep && !inQuotes) {
      out.push(current)
      current = ''
      continue
    }
    current += ch
  }
  out.push(current)
  return out.map((s) => s.trim())
}

function normalizeHeader(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
}

export function parseCarteiraCsv(raw: string): ParseCarteiraResult {
  const text = stripBom(raw).replace(/\r\n?/g, '\n')
  const lines = text.split('\n')

  let firstNonEmpty = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().length > 0) {
      firstNonEmpty = i
      break
    }
  }
  if (firstNonEmpty === -1) {
    return { validas: [], invalidas: [] }
  }

  const headerLine = lines[firstNonEmpty]
  const sep = detectSeparator(headerLine)
  const headers = splitCsvLine(headerLine, sep).map(normalizeHeader)

  let idxNumero = headers.findIndex((h) => HEADERS_NUMERO.has(h))
  let idxIdent = headers.findIndex((h) => HEADERS_IDENTIFICADOR.has(h))

  if (idxNumero === -1 && idxIdent === -1) {
    idxNumero = 0
    idxIdent = 1
  } else if (idxNumero === -1) {
    idxNumero = idxIdent === 0 ? 1 : 0
  } else if (idxIdent === -1) {
    idxIdent = idxNumero === 0 ? 1 : 0
  }

  const validas: ProcessoCarteira[] = []
  const invalidas: ProcessoCarteiraInvalido[] = []

  for (let i = firstNonEmpty + 1; i < lines.length; i++) {
    const linhaNumero = i + 1
    const linha = lines[i]
    if (linha.trim().length === 0) continue

    const cols = splitCsvLine(linha, sep)
    const numero = (cols[idxNumero] || '').trim()
    const identificador = (cols[idxIdent] || '').trim()

    if (!numero && !identificador) {
      invalidas.push({ linha: linhaNumero, motivo: 'linha vazia' })
      continue
    }
    if (!identificador) {
      invalidas.push({ linha: linhaNumero, motivo: 'sem identificador' })
      continue
    }

    validas.push({
      numero_processo: numero,
      identificador,
    })
  }

  return { validas, invalidas }
}
