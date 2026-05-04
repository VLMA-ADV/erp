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
const HEADERS_IDENTIFICADOR = new Set([
  'identificador',
  'identificacao',
  'identificação',
  'nome',
  'nome do caso',
  'nome_do_caso',
  'caso',
  'descricao',
  'descrição',
])

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

/**
 * Aceita CSV em dois formatos:
 *  1. **1 coluna** (formato preferido — daily 04/05): cada linha é o nome do caso.
 *     Cabeçalho opcional ('nome do caso', 'identificador', 'caso', etc.).
 *  2. **2 colunas** (legado, back-compat): `numero_processo` + `identificador`,
 *     em qualquer ordem, com cabeçalho.
 */
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

  const idxNumeroByHeader = headers.findIndex((h) => HEADERS_NUMERO.has(h))
  const idxIdentByHeader = headers.findIndex((h) => HEADERS_IDENTIFICADOR.has(h))

  // Detecta se a primeira linha não-vazia é cabeçalho reconhecido.
  const headerRecognized = idxNumeroByHeader !== -1 || idxIdentByHeader !== -1

  // Se nenhuma coluna do cabeçalho bate com nossos padrões e há apenas 1 coluna
  // por linha, assumimos que a primeira linha JÁ é dado (sem cabeçalho).
  const colsInHeader = splitCsvLine(headerLine, sep).length

  let dataStart: number
  let idxNumero: number
  let idxIdent: number
  let isSingleColumn: boolean

  if (colsInHeader === 1) {
    // Formato 1 coluna. Se header reconhecido (ex: "nome do caso"),
    // pula a primeira linha. Senão, primeira linha já é dado.
    isSingleColumn = true
    idxIdent = 0
    idxNumero = -1
    dataStart = headerRecognized ? firstNonEmpty + 1 : firstNonEmpty
  } else {
    // Formato 2+ colunas (legado). Primeira linha é sempre cabeçalho —
    // se não reconhecemos os nomes, caímos em fallback posicional (col 0/1)
    // e mesmo assim pulamos a primeira linha (compat com testes existentes).
    isSingleColumn = false
    idxNumero = idxNumeroByHeader
    idxIdent = idxIdentByHeader
    if (idxNumero === -1) idxNumero = idxIdent === 0 ? 1 : 0
    if (idxIdent === -1) idxIdent = idxNumero === 0 ? 1 : 0
    dataStart = firstNonEmpty + 1
  }

  const validas: ProcessoCarteira[] = []
  const invalidas: ProcessoCarteiraInvalido[] = []

  for (let i = dataStart; i < lines.length; i++) {
    const linhaNumero = i + 1
    const linha = lines[i]
    if (linha.trim().length === 0) continue

    const cols = splitCsvLine(linha, sep)
    const numero = isSingleColumn ? '' : (cols[idxNumero] || '').trim()
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
