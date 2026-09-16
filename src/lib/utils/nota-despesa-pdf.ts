// Nota de débito + comprovantes num PDF só.
//
// Filipe, 11/09: "incluir uma forma de trazer os arquivos das despesas junto
// com a nota de débito (um consolidador de arquivos pdf talvez)?" — em 16/09
// escolheu PDF único, nota primeiro e comprovantes em seguida.
//
// A nota é desenhada aqui com pdf-lib em vez de reaproveitar o HTML da
// pré-visualização: o navegador não sabe transformar HTML em PDF por conta
// própria (só pela caixa de impressão, que não dá para juntar com outros
// arquivos). O layout segue o mesmo papel timbrado: A4 paisagem, emitente no
// topo, faixa com título e datas, destinatário, tabela e dados bancários.

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import { ESCRITORIO } from './documento-vlma'

// A nota de debito tem favorecido e banco proprios, que a pre-visualizacao
// mantem numa copia local do timbre. Mesmos valores, para os dois documentos
// nao divergirem.
const PAGAMENTO = {
  favorecido: 'Di Lascio & Advogados Associados',
  banco: 'Banco Itaú (341) - Ag. 3835 C/C. 31141-0',
}
import type { NotaDespesaData } from '@/components/faturamento/nota-despesa-preview'

export interface AnexoDespesa {
  despesa_id: string
  kind: 'primario' | 'extra'
  anexo_id: string
  arquivo_nome: string | null
  mime_type: string | null
}

const A4_PAISAGEM: [number, number] = [841.89, 595.28]
const MARGEM = 34
const PRETO = rgb(0.07, 0.07, 0.07)
const CINZA = rgb(0.42, 0.42, 0.42)

const money = (v: number) =>
  `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const dataBR = (valor?: string | null) => {
  if (!valor) return '—'
  const dt = new Date(/^\d{4}-\d{2}-\d{2}$/.test(valor) ? `${valor}T00:00:00` : valor)
  return Number.isNaN(dt.getTime()) ? valor : dt.toLocaleDateString('pt-BR')
}

// WinAnsi (fonte padrão do PDF) não tem alguns caracteres que aparecem em
// nome de arquivo e descrição — troca antes de escrever para não estourar.
const limpar = (texto: string) =>
  (texto || '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-').replace(/ /g, ' ')
    // eslint-disable-next-line no-control-regex
    .replace(/[^\x00-\xFF]/g, '')

function quebrar(texto: string, fonte: PDFFont, tamanho: number, largura: number): string[] {
  const palavras = limpar(texto).split(/\s+/).filter(Boolean)
  const linhas: string[] = []
  let atual = ''
  for (const p of palavras) {
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

export function montarPaginasDaNota(pdf: PDFDocument, data: NotaDespesaData, fontes: { normal: PDFFont; negrito: PDFFont }) {
  const { normal, negrito } = fontes
  const larguraUtil = A4_PAISAGEM[0] - MARGEM * 2
  const colunas = { data: MARGEM, categoria: MARGEM + 70, descricao: MARGEM + 210, valor: A4_PAISAGEM[0] - MARGEM }

  let pagina: PDFPage = pdf.addPage(A4_PAISAGEM)
  let y = A4_PAISAGEM[1] - MARGEM

  const texto = (t: string, x: number, yy: number, tam = 8, fonte = normal, cor = PRETO) =>
    pagina.drawText(limpar(t), { x, y: yy, size: tam, font: fonte, color: cor })
  const textoDireita = (t: string, x: number, yy: number, tam = 8, fonte = normal) =>
    pagina.drawText(limpar(t), { x: x - fonte.widthOfTextAtSize(limpar(t), tam), y: yy, size: tam, font: fonte, color: PRETO })
  const linha = (yy: number, espessura = 0.6) =>
    pagina.drawLine({ start: { x: MARGEM, y: yy }, end: { x: A4_PAISAGEM[0] - MARGEM, y: yy }, thickness: espessura, color: PRETO })

  // Emitente
  texto(ESCRITORIO.razao, MARGEM, y - 10, 9.6, negrito)
  texto(`CNPJ: ${ESCRITORIO.cnpj}`, MARGEM, y - 22, 7.6)
  texto(`I.M.: ${ESCRITORIO.im}   I.E.: ${ESCRITORIO.ie}`, MARGEM, y - 32, 7.6)
  texto(ESCRITORIO.endereco, MARGEM, y - 42, 7.6)
  texto(ESCRITORIO.cidade, MARGEM, y - 52, 7.6)
  y -= 66

  // Faixa com título e datas
  linha(y)
  texto('Nota de Débito', MARGEM, y - 16, 12)
  textoDireita(`Emissão   ${dataBR(data.emissao)}`, A4_PAISAGEM[0] - MARGEM, y - 10, 7.6)
  textoDireita(`Vencimento   ${dataBR(data.vencimento)}`, A4_PAISAGEM[0] - MARGEM, y - 20, 7.6)
  if (data.documentoNumero) textoDireita(`Documento nº   ${data.documentoNumero}`, A4_PAISAGEM[0] - MARGEM, y - 30, 7.6)
  y -= 26
  linha(y)
  y -= 20

  // Destinatário
  texto(data.clienteNome, MARGEM, y, 9.4, negrito)
  y -= 12
  if (data.clienteDocumento) { texto(data.clienteDocumento, MARGEM, y, 8); y -= 11 }
  if (data.clienteEndereco) { texto(data.clienteEndereco, MARGEM, y, 8); y -= 11 }
  y -= 10

  // Contrato / caso
  pagina.drawRectangle({ x: MARGEM, y: y - 4, width: larguraUtil, height: 16, color: rgb(0.91, 0.91, 0.91) })
  texto(`Contrato   ${data.contratoLabel}`, MARGEM + 4, y, 8.4, negrito)
  y -= 18
  if (data.casoLabel) { texto(`Caso   ${data.casoLabel}`, MARGEM + 4, y, 8.4); y -= 16 }

  const cabecalhoTabela = () => {
    texto('Data', colunas.data, y, 7.6, normal, CINZA)
    texto('Categoria', colunas.categoria, y, 7.6, normal, CINZA)
    texto('Descrição', colunas.descricao, y, 7.6, normal, CINZA)
    textoDireita('Valor (R$)', colunas.valor, y, 7.6, normal)
    y -= 4
    linha(y)
    y -= 12
  }
  cabecalhoTabela()

  const larguraDescricao = colunas.valor - colunas.descricao - 70
  for (const item of data.itens) {
    const linhasDesc = quebrar(item.descricao || '—', normal, 8, larguraDescricao)
    const altura = Math.max(linhasDesc.length * 10, 12)
    if (y - altura < MARGEM + 40) {
      pagina = pdf.addPage(A4_PAISAGEM)
      y = A4_PAISAGEM[1] - MARGEM
      cabecalhoTabela()
    }
    texto(dataBR(item.data_lancamento), colunas.data, y, 8)
    texto(item.categoria || '—', colunas.categoria, y, 8)
    linhasDesc.forEach((l, i) => texto(l, colunas.descricao, y - i * 10, 8))
    textoDireita(money(item.valor), colunas.valor, y, 8)
    y -= altura + 4
  }

  const total = data.itens.reduce((acc, i) => acc + Number(i.valor || 0), 0)
  y -= 4
  linha(y)
  y -= 14
  texto('Valor a pagar', colunas.descricao, y, 9.6, negrito)
  textoDireita(money(total), colunas.valor, y, 9.6, negrito)
  y -= 24

  texto('Instruções para pagamento bancário:', MARGEM, y, 7.6, negrito); y -= 11
  texto(`Favorecido: ${PAGAMENTO.favorecido}`, MARGEM, y, 7.6); y -= 10
  texto(`CNPJ ${ESCRITORIO.cnpj}`, MARGEM, y, 7.6); y -= 10
  texto(PAGAMENTO.banco, MARGEM, y, 7.6)

  return pdf
}

function base64ParaBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

function tipoDoArquivo(nome: string, mime: string | null): 'pdf' | 'jpg' | 'png' | 'outro' {
  const n = (nome || '').toLowerCase()
  const m = (mime || '').toLowerCase()
  if (m.includes('pdf') || n.endsWith('.pdf')) return 'pdf'
  if (m.includes('png') || n.endsWith('.png')) return 'png'
  if (m.includes('jpeg') || m.includes('jpg') || n.endsWith('.jpg') || n.endsWith('.jpeg')) return 'jpg'
  return 'outro'
}

/**
 * Monta o PDF final: nota de débito + um bloco por comprovante.
 * Devolve os bytes e a lista do que não deu para anexar (HTML, por exemplo),
 * para a tela avisar em vez de sumir com o arquivo em silêncio.
 */
export async function montarNotaComComprovantes({
  data,
  anexos,
  baixarAnexo,
}: {
  data: NotaDespesaData
  anexos: AnexoDespesa[]
  baixarAnexo: (kind: 'primario' | 'extra', id: string) => Promise<{ base64: string; mime: string | null } | null>
}): Promise<{ bytes: Uint8Array; anexados: number; naoAnexados: string[] }> {
  const pdf = await PDFDocument.create()
  const normal = await pdf.embedFont(StandardFonts.Helvetica)
  const negrito = await pdf.embedFont(StandardFonts.HelveticaBold)

  montarPaginasDaNota(pdf, data, { normal, negrito })

  let anexados = 0
  const naoAnexados: string[] = []

  for (const anexo of anexos) {
    const nome = anexo.arquivo_nome || 'comprovante'
    const baixado = await baixarAnexo(anexo.kind, anexo.anexo_id).catch(() => null)
    if (!baixado) { naoAnexados.push(`${nome} (falha ao baixar)`); continue }
    const tipo = tipoDoArquivo(nome, baixado.mime ?? anexo.mime_type)
    const bytes = base64ParaBytes(baixado.base64)
    try {
      if (tipo === 'pdf') {
        const origem = await PDFDocument.load(bytes, { ignoreEncryption: true })
        const paginas = await pdf.copyPages(origem, origem.getPageIndices())
        paginas.forEach((p) => pdf.addPage(p))
        anexados += 1
      } else if (tipo === 'png' || tipo === 'jpg') {
        const img = tipo === 'png' ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes)
        const pagina = pdf.addPage(A4_PAISAGEM)
        const maxL = A4_PAISAGEM[0] - MARGEM * 2
        const maxA = A4_PAISAGEM[1] - MARGEM * 2 - 18
        const escala = Math.min(maxL / img.width, maxA / img.height, 1)
        const l = img.width * escala
        const a = img.height * escala
        pagina.drawText(limpar(nome), { x: MARGEM, y: A4_PAISAGEM[1] - MARGEM, size: 8, font: normal, color: CINZA })
        pagina.drawImage(img, { x: (A4_PAISAGEM[0] - l) / 2, y: (A4_PAISAGEM[1] - 18 - a) / 2, width: l, height: a })
        anexados += 1
      } else {
        naoAnexados.push(nome)
      }
    } catch {
      naoAnexados.push(`${nome} (arquivo ilegível)`)
    }
  }

  if (naoAnexados.length > 0) {
    const pagina = pdf.addPage(A4_PAISAGEM)
    let y = A4_PAISAGEM[1] - MARGEM
    pagina.drawText('Comprovantes não anexados', { x: MARGEM, y, size: 10, font: negrito, color: PRETO })
    y -= 14
    pagina.drawText('Formatos que não entram num PDF (ex.: HTML) ou arquivos com problema. Baixe pela tela de Despesas.', {
      x: MARGEM, y, size: 8, font: normal, color: CINZA,
    })
    y -= 18
    for (const nome of naoAnexados) {
      pagina.drawText(`• ${limpar(nome)}`, { x: MARGEM, y, size: 8, font: normal, color: PRETO })
      y -= 11
      if (y < MARGEM) break
    }
  }

  return { bytes: await pdf.save(), anexados, naoAnexados }
}
