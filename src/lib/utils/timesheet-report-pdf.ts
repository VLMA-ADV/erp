// Relatório de timesheet em PDF, gerado no navegador com pdf-lib.
//
// Até setembro o relatório abria como HTML numa aba (timesheet-report.ts) e a
// pessoa salvava pela caixa de impressão — bom para olhar, inútil para
// registrar e anexar. Filipe, 21/09 (D12-a/D15-a): o relatório passa a ser
// REGISTRADO quando gerado e vai no e-mail da fatura quando o caso pede. Para
// isso precisa existir como arquivo, e o navegador só transforma HTML em PDF
// pela impressão. Então o desenho é refeito aqui, no mesmo papel timbrado da
// nota de débito (nota-despesa-pdf.ts): A4 paisagem, emitente no topo, faixa
// com título e emissão, destinatário, contrato/caso e a tabela
// data · profissional · descrição · horas · valor, com totais.

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import { ESCRITORIO } from './documento-vlma'

export interface TimesheetPdfRow {
  /** ISO ('2026-08-03') ou já em dd/mm/aaaa. */
  data: string
  profissional: string
  cargo?: string | null
  descricao: string
  /** Horas em decimal (1.5 = 1h 30min). */
  horas: number
  valorHora?: number | null
  valor?: number | null
}

export interface TimesheetPdfInput {
  titulo: string
  cliente: string
  casoLabel?: string | null
  contratoLabel?: string | null
  /** "setembro/2026" — sai na faixa do documento. */
  competenciaLabel?: string | null
  /** Sem valor o relatório mostra só horas (cliente que não vê a tarifa). */
  mostrarValor?: boolean
  rows: TimesheetPdfRow[]
  /** Data de emissão; padrão hoje. */
  emissao?: string
}

const A4_PAISAGEM: [number, number] = [841.89, 595.28]
const MARGEM = 34
const RODAPE_ALTURA = 30
const PRETO = rgb(0.07, 0.07, 0.07)
const CINZA = rgb(0.42, 0.42, 0.42)
const CINZA_CLARO = rgb(0.91, 0.91, 0.91)

const money = (v: number) =>
  `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** "3h 5min", como a tela mostra. */
export function formatarHoras(decimal: number): string {
  const total = Math.round(Number(decimal || 0) * 60)
  const h = Math.floor(total / 60)
  const m = total % 60
  if (!h && !m) return '0h'
  return m ? `${h}h ${m}min` : `${h}h`
}

const dataBR = (valor?: string | null) => {
  if (!valor) return '—'
  if (/^\d{4}-\d{2}-\d{2}/.test(valor)) return valor.slice(0, 10).split('-').reverse().join('/')
  return valor
}

// WinAnsi (fonte padrão do PDF) não cobre tudo que aparece numa descrição de
// timesheet — aspas curvas, travessão, emoji. Troca o que dá e descarta o resto
// para o pdf-lib não estourar no meio do relatório.
const limpar = (texto: string) =>
  String(texto ?? '')
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-').replace(/ /g, ' ')
    .replace(/\r?\n+/g, ' ')
    // eslint-disable-next-line no-control-regex
    .replace(/[^\x00-\xFF]/g, '')

function quebrar(texto: string, fonte: PDFFont, tamanho: number, largura: number): string[] {
  const palavras = limpar(texto).split(/\s+/).filter(Boolean)
  const linhas: string[] = []
  let atual = ''
  for (const palavra of palavras) {
    // Palavra maior que a coluna (URL, número de processo) é cortada na marra.
    let p = palavra
    while (fonte.widthOfTextAtSize(p, tamanho) > largura && p.length > 1) {
      let corte = p.length - 1
      while (corte > 1 && fonte.widthOfTextAtSize(p.slice(0, corte), tamanho) > largura) corte -= 1
      if (atual) { linhas.push(atual); atual = '' }
      linhas.push(p.slice(0, corte))
      p = p.slice(corte)
    }
    const tentativa = atual ? `${atual} ${p}` : p
    if (fonte.widthOfTextAtSize(tentativa, tamanho) > largura && atual) {
      linhas.push(atual)
      atual = p
    } else {
      atual = tentativa
    }
  }
  if (atual) linhas.push(atual)
  return linhas.length ? linhas : ['—']
}

/**
 * Gera o PDF e devolve os bytes. Quem chama decide se abre, sobe para o
 * bucket ou anexa — este módulo não sabe de Supabase nem de window.
 */
export async function gerarRelatorioTimesheetPdf(input: TimesheetPdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  const normal = await pdf.embedFont(StandardFonts.Helvetica)
  const negrito = await pdf.embedFont(StandardFonts.HelveticaBold)
  const mostrarValor = input.mostrarValor !== false

  const larguraUtil = A4_PAISAGEM[0] - MARGEM * 2
  const direita = A4_PAISAGEM[0] - MARGEM
  // Colunas: data | profissional | descrição (o que sobrar) | horas | valor.
  const colunas = {
    data: MARGEM,
    profissional: MARGEM + 62,
    descricao: MARGEM + 62 + 150,
    horas: direita - (mostrarValor ? 90 : 0),
    valor: direita,
  }
  const larguraDescricao = colunas.horas - 70 - colunas.descricao

  let pagina: PDFPage = pdf.addPage(A4_PAISAGEM)
  let y = A4_PAISAGEM[1] - MARGEM

  const texto = (t: string, x: number, yy: number, tam = 8, fonte = normal, cor = PRETO) =>
    pagina.drawText(limpar(t), { x, y: yy, size: tam, font: fonte, color: cor })
  const textoDireita = (t: string, x: number, yy: number, tam = 8, fonte = normal, cor = PRETO) => {
    const limpo = limpar(t)
    pagina.drawText(limpo, { x: x - fonte.widthOfTextAtSize(limpo, tam), y: yy, size: tam, font: fonte, color: cor })
  }
  const linha = (yy: number, espessura = 0.6) =>
    pagina.drawLine({ start: { x: MARGEM, y: yy }, end: { x: direita, y: yy }, thickness: espessura, color: PRETO })

  // Rodapé em toda página, com o timbre e "página x de y" (o "de y" é
  // preenchido no fim, quando se sabe quantas páginas saíram).
  const rodape = (pg: PDFPage) => {
    const yy = MARGEM - 6
    pg.drawLine({ start: { x: MARGEM, y: yy + 12 }, end: { x: direita, y: yy + 12 }, thickness: 0.6, color: PRETO })
    pg.drawText(limpar(ESCRITORIO.rodape), { x: MARGEM, y: yy + 2, size: 7, font: normal, color: PRETO })
    pg.drawText(limpar(ESCRITORIO.site), { x: MARGEM, y: yy - 7, size: 7, font: normal, color: PRETO })
  }

  const novaPagina = () => {
    pagina = pdf.addPage(A4_PAISAGEM)
    y = A4_PAISAGEM[1] - MARGEM
  }

  // Emitente
  texto(ESCRITORIO.razao, MARGEM, y - 10, 9.6, negrito)
  texto(`CNPJ: ${ESCRITORIO.cnpj}`, MARGEM, y - 22, 7.6)
  texto(`I.M.: ${ESCRITORIO.im}   I.E.: ${ESCRITORIO.ie}`, MARGEM, y - 32, 7.6)
  texto(ESCRITORIO.endereco, MARGEM, y - 42, 7.6)
  texto(ESCRITORIO.cidade, MARGEM, y - 52, 7.6)
  textoDireita('VLMA', direita, y - 14, 16, negrito)
  y -= 66

  // Faixa com título, emissão e competência
  linha(y)
  texto(input.titulo || 'Relatório de Timesheet', MARGEM, y - 16, 12)
  const emissao = input.emissao || new Date().toLocaleDateString('pt-BR')
  textoDireita(`Emissão   ${emissao}`, direita, y - 10, 7.6)
  if (input.competenciaLabel) textoDireita(`Competência   ${input.competenciaLabel}`, direita, y - 20, 7.6)
  y -= 26
  linha(y)
  y -= 20

  // Destinatário
  texto(input.cliente || '—', MARGEM, y, 9.4, negrito)
  y -= 20

  // Contrato / caso
  if (input.contratoLabel) {
    pagina.drawRectangle({ x: MARGEM, y: y - 4, width: larguraUtil, height: 16, color: CINZA_CLARO })
    texto(`Contrato   ${input.contratoLabel}`, MARGEM + 4, y, 8.4, negrito)
    y -= 18
  }
  if (input.casoLabel) {
    texto('Caso', MARGEM + 4, y, 8.4, normal, CINZA)
    texto(input.casoLabel, MARGEM + 34, y, 8.4)
    y -= 16
  }

  const cabecalhoTabela = () => {
    texto('Data', colunas.data, y, 7.6, normal, CINZA)
    texto('Profissional', colunas.profissional, y, 7.6, normal, CINZA)
    texto('Descrição', colunas.descricao, y, 7.6, normal, CINZA)
    textoDireita('Horas', colunas.horas, y, 7.6, normal, CINZA)
    if (mostrarValor) textoDireita('Valor (R$)', colunas.valor, y, 7.6, normal, CINZA)
    y -= 4
    linha(y)
    y -= 12
  }
  cabecalhoTabela()

  const limiteInferior = MARGEM + RODAPE_ALTURA
  const ALTURA_LINHA = 10

  let totalHoras = 0
  let totalValor = 0
  for (const item of input.rows) {
    const linhasDesc = quebrar(item.descricao || '—', normal, 8, larguraDescricao)
    const linhasProf = quebrar(
      [item.profissional, item.cargo].filter(Boolean).join(' · ') || '—',
      normal, 8, colunas.descricao - colunas.profissional - 8,
    )
    const altura = Math.max(linhasDesc.length, linhasProf.length) * ALTURA_LINHA
    if (y - altura < limiteInferior) {
      novaPagina()
      cabecalhoTabela()
    }
    texto(dataBR(item.data), colunas.data, y, 8)
    linhasProf.forEach((l, i) => texto(l, colunas.profissional, y - i * ALTURA_LINHA, 8))
    linhasDesc.forEach((l, i) => texto(l, colunas.descricao, y - i * ALTURA_LINHA, 8))
    textoDireita(formatarHoras(item.horas), colunas.horas, y, 8)
    if (mostrarValor) textoDireita(item.valor != null ? money(Number(item.valor)) : '—', colunas.valor, y, 8)
    totalHoras += Number(item.horas || 0)
    totalValor += Number(item.valor || 0)
    y -= altura + 4
  }

  // Totais: nunca sozinhos no topo da página seguinte se couber evitar.
  if (y - 40 < limiteInferior) {
    novaPagina()
  }
  y -= 4
  linha(y)
  y -= 14
  texto('Total', colunas.descricao, y, 9.6, negrito)
  textoDireita(formatarHoras(totalHoras), colunas.horas, y, 9.6, negrito)
  if (mostrarValor) textoDireita(money(totalValor), colunas.valor, y, 9.6, negrito)
  y -= 10

  const paginas = pdf.getPages()
  paginas.forEach((pg, i) => {
    rodape(pg)
    const rotulo = `Página ${i + 1} de ${paginas.length}`
    pg.drawText(limpar(rotulo), {
      x: direita - normal.widthOfTextAtSize(limpar(rotulo), 7), y: MARGEM - 4, size: 7, font: normal, color: CINZA,
    })
  })

  return pdf.save()
}
