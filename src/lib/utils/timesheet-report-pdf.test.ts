import { describe, expect, it } from 'vitest'
import { PDFArray, PDFDocument, PDFRawStream, decodePDFRawStream } from 'pdf-lib'
import { formatarHoras, gerarRelatorioTimesheetPdf, type TimesheetPdfRow } from './timesheet-report-pdf'

// pdf-lib escreve texto de fonte padrão como string hexadecimal no fluxo de
// conteúdo de cada página (comprimido com Flate). Descomprimir e decodificar
// essas strings é o bastante para conferir se um rótulo saiu no PDF, sem
// depender de um extrator de texto.
async function textosDoPdf(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes)
  const partes: string[] = []
  for (const page of doc.getPages()) {
    const contents = page.node.Contents()
    const itens = contents instanceof PDFArray ? contents.asArray() : contents ? [contents] : []
    for (const item of itens) {
      const stream = doc.context.lookup(item)
      if (stream instanceof PDFRawStream) {
        partes.push(Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1'))
      }
    }
  }
  const raw = partes.join('\n')
  const hex = raw.match(/<([0-9A-Fa-f]+)>\s*Tj/g) || []
  return hex
    .map((m) => Buffer.from(m.slice(1, m.indexOf('>')), 'hex').toString('latin1'))
    .join('\n')
}

const linha = (i: number, extra: Partial<TimesheetPdfRow> = {}): TimesheetPdfRow => ({
  data: `2026-08-${String((i % 28) + 1).padStart(2, '0')}`,
  profissional: `Advogado ${i}`,
  cargo: 'Sócio',
  descricao: `Lançamento ${i}: análise de documentos e reunião com o cliente sobre a estratégia processual`,
  horas: 1.5,
  valorHora: 550,
  valor: 825,
  ...extra,
})

describe('gerarRelatorioTimesheetPdf', () => {
  it('gera um PDF de uma página com totais de horas e valor', async () => {
    const bytes = await gerarRelatorioTimesheetPdf({
      titulo: 'Relatório de Timesheet',
      cliente: 'Cliente Teste S.A.',
      casoLabel: '12 - Consultoria trabalhista',
      contratoLabel: '3 - Contrato guarda-chuva',
      competenciaLabel: 'setembro/2026',
      mostrarValor: true,
      rows: [linha(1), linha(2, { horas: 0.5, valor: 275 })],
    })
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBe(1)

    const textos = await textosDoPdf(bytes)
    expect(textos).toContain('Cliente Teste S.A.')
    expect(textos).toContain('12 - Consultoria trabalhista')
    expect(textos).toContain('Total')
    // 1.5h + 0.5h = 2h; 825 + 275 = 1.100,00
    expect(textos).toContain('2h')
    expect(textos).toContain('R$ 1.100,00')
  })

  it('quebra em várias páginas com muitas linhas e mantém o total no fim', async () => {
    const rows = Array.from({ length: 120 }, (_, i) => linha(i))
    const bytes = await gerarRelatorioTimesheetPdf({
      titulo: 'Relatório de Timesheet',
      cliente: 'Cliente Grande Ltda.',
      mostrarValor: true,
      rows,
    })
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBeGreaterThan(3)

    const textos = await textosDoPdf(bytes)
    // 120 × 1,5h = 180h; 120 × 825 = 99.000,00
    expect(textos).toContain('180h')
    expect(textos).toContain('R$ 99.000,00')
    expect(textos).toContain(`Página ${doc.getPageCount()} de ${doc.getPageCount()}`)
  })

  it('sem mostrarValor não imprime valores nem a coluna', async () => {
    const bytes = await gerarRelatorioTimesheetPdf({
      titulo: 'Relatório de Timesheet',
      cliente: 'Cliente',
      mostrarValor: false,
      rows: [linha(1)],
    })
    const textos = await textosDoPdf(bytes)
    expect(textos).not.toContain('Valor (R$)')
    expect(textos).not.toContain('R$ 825,00')
    expect(textos).toContain('1h 30min')
  })

  it('descrição longa sem espaços não estoura a coluna', async () => {
    const bytes = await gerarRelatorioTimesheetPdf({
      titulo: 'Relatório de Timesheet',
      cliente: 'Cliente',
      rows: [linha(1, { descricao: 'x'.repeat(600) })],
    })
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBe(1)
  })
})

describe('formatarHoras', () => {
  it('formata decimal como a tela', () => {
    expect(formatarHoras(0)).toBe('0h')
    expect(formatarHoras(1.5)).toBe('1h 30min')
    expect(formatarHoras(3)).toBe('3h')
    expect(formatarHoras(0.25)).toBe('0h 15min')
  })
})
