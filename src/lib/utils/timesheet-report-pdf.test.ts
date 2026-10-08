import { describe, expect, it } from 'vitest'
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib'
import { divisaoPorPagador, formatarHoras, gerarRelatorioTimesheetPdf, type FotoBaixada, type TimesheetPdfRow } from './timesheet-report-pdf'
import { LOGO_VLMA } from './documento-vlma'

// Conteúdo bruto (descomprimido) de todas as páginas: serve para procurar
// operadores de desenho (logo vetorial, clip do avatar, XObject de imagem).
async function conteudoDoPdf(bytes: Uint8Array): Promise<string> {
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
  return partes.join('\n')
}

// Quantas imagens distintas as páginas usam — o pdf-lib cria uma chave nova
// no dicionário XObject a cada drawImage, mas todas apontam para o mesmo
// objeto quando a foto foi embutida uma vez só (e PNG com alfa ainda gera
// um SMask à parte, por isso não dá para contar objetos /Image do arquivo).
async function imagensEmbutidas(bytes: Uint8Array): Promise<number> {
  const doc = await PDFDocument.load(bytes)
  const refs = new Set<string>()
  for (const page of doc.getPages()) {
    const xobjects = page.node.Resources()?.lookup(PDFName.of('XObject'))
    if (!(xobjects instanceof PDFDict)) continue
    for (const [, ref] of xobjects.entries()) refs.add(String(ref))
  }
  return refs.size
}

// PNG 1×1 laranja, o menor que o pdf-lib aceita.
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

// pdf-lib escreve texto de fonte padrão como string hexadecimal no fluxo de
// conteúdo de cada página (comprimido com Flate). Descomprimir e decodificar
// essas strings é o bastante para conferir se um rótulo saiu no PDF, sem
// depender de um extrator de texto.
async function textosDoPdf(bytes: Uint8Array): Promise<string> {
  const raw = await conteudoDoPdf(bytes)
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

describe('logo e foto no relatório', () => {
  const base = { titulo: 'Relatório de Timesheet', cliente: 'Cliente', mostrarValor: true }

  it('desenha a marca VLMA como vetor (não mais o texto "VLMA") no cabeçalho', async () => {
    const bytes = await gerarRelatorioTimesheetPdf({ ...base, rows: [linha(1)] })
    const textos = await textosDoPdf(bytes)
    expect(textos.split('\n')).not.toContain('VLMA')
    const conteudo = await conteudoDoPdf(bytes)
    // Cor laranja do ponto (#FF9900 → 1 0.6 0 rg); o traço é preto como o texto.
    expect(conteudo).toMatch(/1 0\.6 0 rg/)
    // Os dois paths saem como curvas Bézier; o segundo tem muitas.
    expect((conteudo.match(/ c\n/g) || []).length).toBeGreaterThan(50)
    expect(LOGO_VLMA.paths).toHaveLength(2)
  })

  it('sem fotoUrl não incorpora imagem nem desenha avatar', async () => {
    const bytes = await gerarRelatorioTimesheetPdf({ ...base, rows: [linha(1), linha(2)] })
    expect(await imagensEmbutidas(bytes)).toBe(0)
    // Sem clip circular
    expect(await conteudoDoPdf(bytes)).not.toMatch(/W\nn/)
  })

  it('com fotoUrl baixa uma vez por URL, embute a imagem e recorta em círculo', async () => {
    const chamadas: string[] = []
    const baixarFoto = async (url: string): Promise<FotoBaixada | null> => {
      chamadas.push(url)
      return { bytes: new Uint8Array(PNG_1X1), contentType: 'image/png' }
    }
    const rows = [
      linha(1, { profissional: 'Ana Souza', fotoUrl: 'https://x/ana.png' }),
      linha(2, { profissional: 'Ana Souza', fotoUrl: 'https://x/ana.png' }),
      linha(3, { profissional: 'Bruno Lima', fotoUrl: 'https://x/bruno.png' }),
      linha(4, { profissional: 'Carla Dias', fotoUrl: null }),
    ]
    const bytes = await gerarRelatorioTimesheetPdf({ ...base, rows, baixarFoto })
    expect(chamadas.sort()).toEqual(['https://x/ana.png', 'https://x/bruno.png'])

    // Duas imagens embutidas (Ana reaproveitada), três desenhos + clip.
    expect(await imagensEmbutidas(bytes)).toBe(2)
    const conteudo = await conteudoDoPdf(bytes)
    expect((conteudo.match(/W\nn\n/g) || []).length).toBe(3)
    expect((conteudo.match(/\/Image-?\d+ Do/g) || []).length).toBe(3)
    // Carla, sem foto, sai com as iniciais num círculo.
    const textos = await textosDoPdf(bytes)
    expect(textos.split('\n')).toContain('CD')
    expect(textos).toContain('Ana Souza')
  })

  it('foto que falha ou vem em formato desconhecido cai nas iniciais', async () => {
    const baixarFoto = async (url: string): Promise<FotoBaixada | null> => {
      if (url.endsWith('erro')) throw new Error('rede')
      if (url.endsWith('nula')) return null
      return { bytes: new Uint8Array([1, 2, 3, 4, 5]), contentType: 'image/gif' }
    }
    const rows = [
      linha(1, { profissional: 'Ana Souza', fotoUrl: 'https://x/erro' }),
      linha(2, { profissional: 'Bruno Lima', fotoUrl: 'https://x/nula' }),
      linha(3, { profissional: 'Carla Dias', fotoUrl: 'https://x/gif' }),
    ]
    const bytes = await gerarRelatorioTimesheetPdf({ ...base, rows, baixarFoto })
    expect(await imagensEmbutidas(bytes)).toBe(0)
    const textos = (await textosDoPdf(bytes)).split('\n')
    expect(textos).toContain('AS')
    expect(textos).toContain('BL')
    expect(textos).toContain('CD')
  })

  it('JPEG identificado pelos bytes quando o content-type não ajuda', async () => {
    // JPEG mínimo válido não é trivial; aqui basta que o sniff escolha jpg e
    // o embed falhe de forma controlada (cai nas iniciais, sem estourar).
    const baixarFoto = async (): Promise<FotoBaixada | null> =>
      ({ bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]), contentType: 'application/octet-stream' })
    const bytes = await gerarRelatorioTimesheetPdf({ ...base, rows: [linha(1, { profissional: 'Ana Souza', fotoUrl: 'https://x/a' })], baixarFoto })
    expect((await textosDoPdf(bytes)).split('\n')).toContain('AS')
  })
})

describe('divisão por pagador', () => {
  const base = { titulo: 'Relatório de Timesheet', cliente: 'Thiago Coneglian', mostrarValor: true }

  it('divide o total pelo percentual; o último absorve a diferença de centavos', () => {
    expect(divisaoPorPagador(100, 'X', [
      { nome: 'A', percentual: 33.33 },
      { nome: 'B', percentual: 33.33 },
      { nome: 'C', percentual: 33.34 },
    ])).toEqual([
      { nome: 'A', percentual: 33.33, valor: 33.33 },
      { nome: 'B', percentual: 33.33, valor: 33.33 },
      { nome: 'C', percentual: 33.34, valor: 33.34 },
    ])
    // 1.100,01 × 50% = 550,005 → 550,01 no primeiro; o segundo fica com 550,00.
    const d = divisaoPorPagador(1100.01, 'X', [{ nome: 'A', percentual: 50 }, { nome: 'B', percentual: 50 }])!
    expect(d.map((l) => l.valor)).toEqual([550.01, 550])
    expect(d.reduce((a, l) => a + Math.round(l.valor * 100), 0)).toBe(110001)
  })

  it('não se aplica sem pagador ou com um só igual ao cliente', () => {
    expect(divisaoPorPagador(100, 'Cliente', null)).toBeNull()
    expect(divisaoPorPagador(100, 'Cliente', [])).toBeNull()
    expect(divisaoPorPagador(100, 'Cliente', [{ nome: ' cliente ', percentual: 100 }])).toBeNull()
    expect(divisaoPorPagador(100, 'Cliente', [{ nome: 'Outro', percentual: 100 }])).toEqual([
      { nome: 'Outro', percentual: 100, valor: 100 },
    ])
  })

  it('com rateio, fecha o relatório com o quadro depois do total', async () => {
    const bytes = await gerarRelatorioTimesheetPdf({
      ...base,
      pagadores: [
        { nome: 'Felipe Coneglian Della Bianca', percentual: 50 },
        { nome: 'Thiago Coneglian', percentual: 50 },
      ],
      rows: [linha(1), linha(2, { horas: 0.5, valor: 275.01 })],
    })
    const textos = (await textosDoPdf(bytes)).split('\n')
    expect(textos).not.toContain('Faturado a')
    const iTotal = textos.indexOf('Total')
    const iQuadro = textos.indexOf('Divisão por pagador')
    expect(iTotal).toBeGreaterThan(-1)
    expect(iQuadro).toBeGreaterThan(iTotal)
    // 1.100,01 → 550,01 + 550,00
    const depois = textos.slice(iQuadro)
    expect(depois).toEqual(expect.arrayContaining([
      'Felipe Coneglian Della Bianca', 'Thiago Coneglian', '50%', 'R$ 550,01', 'R$ 550,00',
    ]))
  })

  it('pagador único diferente do cliente também ganha o quadro', async () => {
    const bytes = await gerarRelatorioTimesheetPdf({
      ...base,
      cliente: 'Strobel',
      pagadores: [{ nome: 'Mendocino Participações', percentual: 100 }],
      rows: [linha(1)],
    })
    const textos = (await textosDoPdf(bytes)).split('\n')
    expect(textos).toContain('Divisão por pagador')
    expect(textos).toContain('Mendocino Participações')
    expect(textos).toContain('100%')
  })

  it('pagador igual ao cliente: relatório idêntico ao sem pagadores', async () => {
    const emissao = '08/10/2026'
    const sem = await gerarRelatorioTimesheetPdf({ ...base, emissao, rows: [linha(1)] })
    const com = await gerarRelatorioTimesheetPdf({
      ...base, emissao, pagadores: [{ nome: 'Thiago Coneglian', percentual: 100 }], rows: [linha(1)],
    })
    expect(await conteudoDoPdf(com)).toBe(await conteudoDoPdf(sem))
    expect(await textosDoPdf(com)).not.toContain('Divisão por pagador')
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
