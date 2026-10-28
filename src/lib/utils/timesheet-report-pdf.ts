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

import {
  PDFDocument, StandardFonts, rgb,
  appendBezierCurve, clip, closePath, endPath, moveTo, popGraphicsState, pushGraphicsState,
  type PDFFont, type PDFImage, type PDFPage,
} from 'pdf-lib'
import { ESCRITORIO, tituloComNumero } from './documento-vlma'
import { desenharLogoVlma, LOGO_LARGURA_TIMBRE } from './logo-vlma-pdf'
import { colunasComValor, type QuadroImpostosPagador } from '../faturamento/quadro-impostos'

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
  /**
   * URL (assinada) da foto do profissional. Quando alguma linha traz foto, o
   * relatório ganha um avatar redondo antes do nome em TODAS as linhas — quem
   * não tem foto (ou cuja foto falhou) sai com as iniciais num círculo cinza.
   */
  fotoUrl?: string | null
}

export interface PagadorRelatorio {
  nome: string | null
  percentual: number
}

export interface LinhaDivisaoPagador {
  nome: string
  percentual: number
  valor: number
}

const mesmoNome = (a: string | null | undefined, b: string | null | undefined) =>
  String(a ?? '').trim().toLocaleLowerCase('pt-BR') === String(b ?? '').trim().toLocaleLowerCase('pt-BR')

/**
 * Linhas do quadro "Divisão por pagador": valor = total × percentual,
 * arredondado a centavos, com o ÚLTIMO pagador absorvendo a diferença para a
 * soma bater com o total. Devolve null quando o quadro não se aplica (nenhum
 * pagador, ou um só e igual ao cliente).
 */
export function divisaoPorPagador(
  total: number,
  cliente: string,
  pagadores: PagadorRelatorio[] | null | undefined,
): LinhaDivisaoPagador[] | null {
  const lista = (pagadores ?? []).filter(Boolean)
  if (lista.length === 0) return null
  if (lista.length === 1 && mesmoNome(lista[0].nome, cliente)) return null
  const totalCentavos = Math.round(Number(total || 0) * 100)
  let acumulado = 0
  return lista.map((p, i) => {
    const percentual = Number(p.percentual || 0)
    const centavos = i === lista.length - 1
      ? totalCentavos - acumulado
      : Math.round((totalCentavos * percentual) / 100)
    acumulado += centavos
    return { nome: p.nome?.trim() || 'Pagador', percentual, valor: centavos / 100 }
  })
}

const percentualBR = (v: number) =>
  `${Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`

/**
 * Pagadores que saem no CABEÇALHO, junto do destinatário (cliente, out/2026:
 * relatório único com todos os pagadores e percentuais logo no topo). Só com
 * rateio — mais de um pagador; sem rateio o cabeçalho fica como sempre e o
 * quadro "Divisão por pagador" do fim continua cuidando do pagador único
 * diferente do cliente. Devolve null quando não se aplica.
 */
export function pagadoresDoCabecalho(
  pagadores: PagadorRelatorio[] | null | undefined,
): Array<{ nome: string; percentual: string }> | null {
  const lista = (pagadores ?? []).filter(Boolean)
  if (lista.length < 2) return null
  return lista.map((p) => ({ nome: p.nome?.trim() || 'Pagador', percentual: percentualBR(p.percentual) }))
}

export interface ImpostosRelatorio {
  linhas: QuadroImpostosPagador[]
  /** Nome do grupo de impostos, citado na nota das estimativas. */
  grupoNome?: string | null
}

/**
 * Colunas e textos do quadro "Impostos". Decisão sobre zeros: só entram as
 * colunas de imposto com valor em ALGUM pagador — sem retenção nenhuma o
 * quadro fica Pagador · Valor bruto · Retenções ("sem retenção") · Valor
 * líquido, em vez de seis colunas de R$ 0,00. Dentro de uma coluna que existe,
 * o pagador sem aquele imposto sai com "—".
 *
 * Um valor por pagador: quando o quadro sai, ele SUBSTITUI a "Divisão por
 * pagador" (que repartia o total das horas). O bruto do quadro é o da NFS-e
 * — o que o pagador de fato recebe/receberá — e o total das horas pode não
 * bater com ele: em produção, kits de honorário fixo (NF 2228/2229, V&G e
 * Pró-Vascular: horas a R$ 0,00, notas de R$ 1.750) e o arredondamento por
 * pagador da emit-nfse (NF 2223/2224, Heusy: R$ 833,33 em 50/50 virou
 * 416,67 + 416,67). `totalHoras` é o total impresso no relatório; quando
 * difere da soma dos brutos, uma linha diz quanto e por quê.
 */
export function layoutQuadroImpostos(imp: ImpostosRelatorio | null | undefined, totalHoras?: number) {
  const linhas = (imp?.linhas ?? []).filter((l) => l.bruto > 0)
  if (linhas.length === 0) return null
  const colunas = colunasComValor(linhas)
  const situacao = (l: QuadroImpostosPagador) =>
    l.origem === 'emitida'
      ? (l.nfseNumero ? `NFS-e ${l.nfseNumero}` : 'NFS-e emitida')
      : l.origem === 'estimado' ? 'estimado' : 'sem grupo de impostos'
  const notas: string[] = []
  if (linhas.some((l) => l.origem === 'estimado')) {
    notas.push(
      `Estimado: NFS-e ainda não emitida; valores calculados pelas regras do grupo de impostos${imp?.grupoNome ? ` (${imp.grupoNome})` : ''} ` +
      'e pelo acumulado do mês do pagador. O valor final é o da NFS-e.',
    )
  }
  if (linhas.some((l) => l.origem === 'sem_grupo')) {
    notas.push('Sem grupo de impostos no cadastro: retenções não calculadas.')
  }
  if (typeof totalHoras === 'number') {
    const somaBruto = Math.round(linhas.reduce((s, l) => s + l.bruto, 0) * 100)
    const diferenca = somaBruto - Math.round(totalHoras * 100)
    if (diferenca !== 0) {
      const motivo = Math.abs(diferenca) <= linhas.length
        ? 'cada NFS-e é arredondada a centavos sobre a parte do pagador'
        : 'a NFS-e é emitida sobre o valor do serviço do kit (honorário fixo, mensalidade ou ajuste), não sobre a soma das horas'
      notas.push(
        `O valor bruto das NFS-e (${money(somaBruto / 100)}) difere do total das horas (${money(totalHoras)}) ` +
        `em ${money(Math.abs(diferenca) / 100)}: ${motivo}.`,
      )
    }
  }
  return { linhas, colunas, situacao, notas }
}

/**
 * Valor fixo do caso (mensalidade) no relatório — cliente, out/2026. Montado
 * em components/faturamento/composicao/valor-fixo-relatorio.ts.
 */
export interface ValorFixoRelatorio {
  /** "Mensalidade setembro/2026" (mês do serviço). */
  rotulo: string
  /** null = a mensalidade não está neste kit; `observacao` diz onde está. */
  valor: number | null
  observacao?: string | null
  /**
   * Rótulo da linha que soma as horas com valor, abaixo da mensalidade.
   * Padrão: o excedente do teto da mensalidade. Na carteira com "Valor da
   * hora" (out/2026) toda hora é cobrada — "Horas cobradas (valor da hora da
   * carteira)".
   */
  rotuloHoras?: string | null
}

export const ROTULO_HORAS_EXCEDENTES = 'Horas excedentes (acima do teto da mensalidade)'

const temValor = (v: number | null | undefined) => Math.round(Number(v || 0) * 100) > 0

/**
 * Totais do relatório. Sem valor fixo, como sempre: o total é a soma das
 * linhas. Com valor fixo: total = mensalidade + excedente (as linhas com
 * valor são as horas acima do teto, ou todas as horas na carteira com valor
 * da hora), e a coluna Valor só existe se alguma
 * linha tiver valor — linha de caso mensal não imprime "R$ 0,00".
 */
export function totaisDoRelatorio(rows: TimesheetPdfRow[], valorFixo?: ValorFixoRelatorio | null, mostrarValor = true) {
  const horas = rows.reduce((s, r) => s + Number(r.horas || 0), 0)
  const valorLinhas = Math.round(rows.reduce((s, r) => s + Number(r.valor || 0), 0) * 100) / 100
  if (!valorFixo) {
    return { horas, valorLinhas, fixo: null, excedente: 0, total: valorLinhas, colunaValor: mostrarValor }
  }
  const fixo = valorFixo.valor != null ? Number(valorFixo.valor) : null
  const total = Math.round(((fixo ?? 0) + valorLinhas) * 100) / 100
  return {
    horas,
    valorLinhas,
    fixo,
    excedente: valorLinhas,
    total,
    colunaValor: mostrarValor && rows.some((r) => temValor(r.valor)),
  }
}

/**
 * Uma seção do relatório consolidado por contrato (Filipe, 16/10: Pattac com
 * seis casos num relatório só; Jamute com o fixo no caso 365 e as horas no
 * 1828): as linhas de um caso, com o total dele. O valor fixo do caso não
 * entra no total da seção — vai para o fim, antes do total geral.
 */
export interface SecaoRelatorio {
  casoLabel: string
  rows: TimesheetPdfRow[]
  valorFixo?: ValorFixoRelatorio | null
}

/**
 * Totais do consolidado. Por seção: horas e o valor das linhas (no caso de
 * valor fixo, só o excedente/horas cobradas, como no relatório do caso). No
 * fim: cada valor fixo e o total geral = soma das linhas + valores fixos.
 */
export function totaisConsolidados(secoes: SecaoRelatorio[], mostrarValor = true) {
  const porSecao = secoes.map((s) => {
    const t = totaisDoRelatorio(s.rows, s.valorFixo ?? null, mostrarValor)
    return { casoLabel: s.casoLabel, horas: t.horas, valorLinhas: t.valorLinhas, valorFixo: s.valorFixo ?? null }
  })
  const fixos = porSecao.filter((s) => s.valorFixo).map((s) => ({ casoLabel: s.casoLabel, ...s.valorFixo! }))
  const centavosLinhas = porSecao.reduce((acc, s) => acc + Math.round(s.valorLinhas * 100), 0)
  const centavosFixos = fixos.reduce((acc, f) => acc + Math.round(Number(f.valor ?? 0) * 100), 0)
  return {
    porSecao,
    fixos,
    horas: porSecao.reduce((acc, s) => acc + s.horas, 0),
    valorLinhas: centavosLinhas / 100,
    total: (centavosLinhas + centavosFixos) / 100,
    // Coluna Valor: some só quando TODA seção é de valor fixo sem hora cobrada.
    colunaValor: mostrarValor && secoes.some((s) => !s.valorFixo || s.rows.some((r) => temValor(r.valor))),
  }
}

/** Bytes de uma foto já baixada e o content-type que veio na resposta. */
export interface FotoBaixada {
  bytes: Uint8Array
  contentType: string | null
}

export interface TimesheetPdfInput {
  titulo: string
  /**
   * Nº do documento (numeração única do escritório, out/2026 — reservada antes
   * de montar o PDF por reservar_numero_documento). Sai no título da faixa:
   * "Relatório de timesheet nº 15". Sem ele, o título de sempre.
   */
  numeroDocumento?: number | string | null
  cliente: string
  /**
   * Pagadores do kit (nome e percentual do rateio). Com mais de um, ou com um
   * só diferente do cliente, o relatório fecha com o quadro "Divisão por
   * pagador" depois do total (Filipe, 08/10). Com mais de um (rateio), nomes
   * e percentuais também saem no cabeçalho, abaixo do destinatário (out/2026).
   * Um pagador igual ao cliente (ou nenhum) = relatório de sempre.
   */
  pagadores?: PagadorRelatorio[] | null
  casoLabel?: string | null
  contratoLabel?: string | null
  /**
   * "setembro/2026" — sai na faixa do documento. É o MÊS DO SERVIÇO das horas
   * (competência do kit − 1; ver lib/faturamento/competencia-do-servico.ts),
   * não o ciclo de cobrança.
   */
  competenciaLabel?: string | null
  /** Sem valor o relatório mostra só horas (cliente que não vê a tarifa). */
  mostrarValor?: boolean
  rows: TimesheetPdfRow[]
  /** Data de emissão; padrão hoje. */
  emissao?: string
  /**
   * Quadro "Impostos" por pagador (cliente, out/2026): bruto, retenções e
   * líquido de cada NFS-e — real quando já emitida, estimado quando não.
   * Montado por lib/faturamento/quadro-impostos. Sem ele (ou sem valor), o
   * relatório termina como antes.
   */
  impostos?: ImpostosRelatorio | null
  /**
   * Caso de valor fixo (mensalidade). Com ele, as linhas sem valor saem sem
   * a coluna Valor, a mensalidade do mês entra depois das horas e o total é
   * mensalidade + excedente (linhas com valor = horas acima do teto). Quadro
   * de impostos e divisão por pagador usam esse total. Sem ele (pró-labore,
   * projeto, hora), o relatório de sempre.
   */
  valorFixo?: ValorFixoRelatorio | null
  /**
   * Relatório consolidado por contrato: uma seção por caso. Com seções,
   * `rows`, `casoLabel` e `valorFixo` são ignorados — cada seção traz os seus.
   */
  secoes?: SecaoRelatorio[] | null
  /**
   * Como baixar cada foto (padrão: `fetch` global). Injetável para teste e
   * para quem já tem os bytes. Deve devolver null quando não conseguir.
   */
  baixarFoto?: (url: string) => Promise<FotoBaixada | null>
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

/** Diâmetro do avatar redondo antes do nome do profissional. */
const AVATAR = 14
const AVATAR_FUNDO = rgb(0.85, 0.85, 0.85)

const iniciais = (nome: string) =>
  limpar(nome || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || '')
    .join('') || '?'

async function baixarFotoPadrao(url: string): Promise<FotoBaixada | null> {
  if (typeof fetch !== 'function') return null
  const resp = await fetch(url)
  if (!resp.ok) return null
  const bytes = new Uint8Array(await resp.arrayBuffer())
  const contentType = resp.headers.get('content-type')
  // No navegador, toda foto passa pelo canvas: vira um quadrado CENTRAL com o
  // maior lado possível (a foto inteira, não um pedaço), reduzido a 160 px e
  // em PNG. Resolve duas coisas de uma vez: WebP (metade das fotos; pdf-lib
  // não embute) e foto retangular, que esticava no círculo. A versão de 28/09
  // recortava 160 px do centro da imagem ORIGINAL — em foto grande virava zoom
  // na orelha (Filipe, 06/10). Fora do navegador (testes), vai como veio.
  if (typeof document === 'undefined' || typeof createImageBitmap !== 'function') return { bytes, contentType }
  try {
    const bmp = await createImageBitmap(new Blob([bytes], { type: contentType || 'image/*' }))
    const lado = Math.min(bmp.width, bmp.height)
    const sx = Math.floor((bmp.width - lado) / 2)
    const sy = Math.floor((bmp.height - lado) / 2)
    const destino = 160
    const canvas = document.createElement('canvas')
    canvas.width = destino; canvas.height = destino
    const ctx = canvas.getContext('2d')
    if (!ctx) return { bytes, contentType }
    ctx.drawImage(bmp, sx, sy, lado, lado, 0, 0, destino, destino)
    const png = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'))
    if (!png) return { bytes, contentType }
    return { bytes: new Uint8Array(await png.arrayBuffer()), contentType: 'image/png' }
  } catch {
    return { bytes, contentType }
  }
}

// PNG começa com 0x89 'P' 'N' 'G'; JPEG com FF D8 FF. O content-type do
// storage costuma vir certo, mas foto antiga subida como "octet-stream" ou
// com extensão errada ainda precisa entrar.
function tipoDaImagem(foto: FotoBaixada): 'png' | 'jpg' | null {
  const ct = (foto.contentType || '').toLowerCase()
  if (ct.includes('png')) return 'png'
  if (ct.includes('jpeg') || ct.includes('jpg')) return 'jpg'
  const b = foto.bytes
  if (b.length > 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png'
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg'
  return null
}

/**
 * Baixa e incorpora cada foto UMA vez por URL (o mesmo profissional aparece
 * em dezenas de linhas). Falha de rede, formato desconhecido ou imagem
 * corrompida viram null — a linha cai nas iniciais, o relatório sai.
 */
async function carregarFotos(
  pdf: PDFDocument,
  rows: TimesheetPdfRow[],
  baixar: (url: string) => Promise<FotoBaixada | null>,
): Promise<Map<string, PDFImage>> {
  const urls = Array.from(new Set(rows.map((r) => r.fotoUrl).filter((u): u is string => !!u)))
  const resultado = new Map<string, PDFImage>()
  await Promise.all(urls.map(async (url) => {
    try {
      const foto = await baixar(url)
      if (!foto || !foto.bytes.length) return
      const tipo = tipoDaImagem(foto)
      if (!tipo) return
      const img = tipo === 'png' ? await pdf.embedPng(foto.bytes) : await pdf.embedJpg(foto.bytes)
      resultado.set(url, img)
    } catch {
      // sem foto: iniciais
    }
  }))
  return resultado
}

// Círculo como caminho de 4 curvas de Bézier (kappa = 0.5523), sem
// pintar — serve de clip. O drawEllipsePath do pdf-lib não presta para isso:
// ele embrulha o caminho em q/Q, e o Q descarta o caminho antes do `W n`.
const KAPPA = 0.5523
function caminhoCirculo(cx: number, cy: number, r: number) {
  const k = KAPPA * r
  return [
    moveTo(cx + r, cy),
    appendBezierCurve(cx + r, cy + k, cx + k, cy + r, cx, cy + r),
    appendBezierCurve(cx - k, cy + r, cx - r, cy + k, cx - r, cy),
    appendBezierCurve(cx - r, cy - k, cx - k, cy - r, cx, cy - r),
    appendBezierCurve(cx + k, cy - r, cx + r, cy - k, cx + r, cy),
    closePath(),
  ]
}

/**
 * Avatar redondo com o canto superior esquerdo em (x, topo). Com imagem,
 * recorta num círculo (clip path do PDF: `W n` sobre o caminho circular) e
 * desenha a foto preenchendo o círculo, centralizada. Sem imagem, círculo
 * cinza com as iniciais.
 */
function desenharAvatar(
  pagina: PDFPage, fonte: PDFFont, nome: string, img: PDFImage | undefined, x: number, topo: number,
) {
  const raio = AVATAR / 2
  const cx = x + raio
  const cy = topo - raio
  if (img) {
    const escala = Math.max(AVATAR / img.width, AVATAR / img.height)
    const largura = img.width * escala
    const altura = img.height * escala
    pagina.pushOperators(pushGraphicsState(), ...caminhoCirculo(cx, cy, raio), clip(), endPath())
    pagina.drawImage(img, { x: cx - largura / 2, y: cy - altura / 2, width: largura, height: altura })
    pagina.pushOperators(popGraphicsState())
    return
  }
  pagina.drawCircle({ x: cx, y: cy, size: raio, color: AVATAR_FUNDO })
  const texto = iniciais(nome)
  const tam = texto.length > 1 ? 5.5 : 6.5
  pagina.drawText(texto, {
    x: cx - fonte.widthOfTextAtSize(texto, tam) / 2,
    y: cy - tam * 0.36,
    size: tam,
    font: fonte,
    color: CINZA,
  })
}

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
  const secoes = input.secoes?.length
    ? input.secoes.map((s) => ({ ...s, valorFixo: mostrarValor ? s.valorFixo ?? null : null }))
    : null
  const valorFixo = mostrarValor && !secoes ? input.valorFixo ?? null : null
  const todasAsLinhas = secoes ? secoes.flatMap((s) => s.rows) : input.rows
  const totais = totaisDoRelatorio(todasAsLinhas, valorFixo, mostrarValor)
  const consolidado = secoes ? totaisConsolidados(secoes, mostrarValor) : null
  // Coluna Valor: sempre no relatório comum; no de valor fixo, só com excedente.
  const colunaValor = consolidado ? consolidado.colunaValor : totais.colunaValor
  // Avatar só existe se alguma linha veio com foto; senão o layout é o de
  // sempre (nome encostado na coluna).
  const comAvatar = todasAsLinhas.some((r) => !!r.fotoUrl)
  const fotos = comAvatar ? await carregarFotos(pdf, todasAsLinhas, input.baixarFoto ?? baixarFotoPadrao) : new Map<string, PDFImage>()
  const recuoNome = comAvatar ? AVATAR + 4 : 0

  const larguraUtil = A4_PAISAGEM[0] - MARGEM * 2
  const direita = A4_PAISAGEM[0] - MARGEM
  // Colunas: data | profissional | descrição (o que sobrar) | horas | valor.
  const colunas = {
    data: MARGEM,
    profissional: MARGEM + 62,
    descricao: MARGEM + 62 + 150,
    horas: direita - (colunaValor ? 90 : 0),
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
  desenharLogoVlma(pagina, { x: direita - LOGO_LARGURA_TIMBRE, y: y - 6, largura: LOGO_LARGURA_TIMBRE })
  y -= 66

  // Faixa com título, emissão e competência
  linha(y)
  texto(tituloComNumero(input.titulo || 'Relatório de Timesheet', input.numeroDocumento), MARGEM, y - 16, 12)
  const emissao = input.emissao || new Date().toLocaleDateString('pt-BR')
  textoDireita(`Emissão   ${emissao}`, direita, y - 10, 7.6)
  if (input.competenciaLabel) textoDireita(`Competência   ${input.competenciaLabel}`, direita, y - 20, 7.6)
  y -= 26
  linha(y)
  y -= 20

  // Destinatário
  texto(input.cliente || '—', MARGEM, y, 9.4, negrito)
  // Com rateio, os pagadores e percentuais vêm logo abaixo, um por linha.
  const pagadoresTopo = pagadoresDoCabecalho(input.pagadores)
  if (pagadoresTopo) {
    y -= 13
    texto('Pagadores', MARGEM, y, 8, normal, CINZA)
    const xNome = MARGEM + 50
    const larguraNome = Math.max(...pagadoresTopo.map((p) => normal.widthOfTextAtSize(limpar(p.nome), 8)))
    for (const [i, p] of pagadoresTopo.entries()) {
      if (i > 0) y -= 11
      texto(p.nome, xNome, y, 8)
      texto(p.percentual, xNome + larguraNome + 12, y, 8)
    }
  }
  y -= 20

  // Contrato / caso
  if (input.contratoLabel) {
    pagina.drawRectangle({ x: MARGEM, y: y - 4, width: larguraUtil, height: 16, color: CINZA_CLARO })
    texto(`Contrato   ${input.contratoLabel}`, MARGEM + 4, y, 8.4, negrito)
    y -= 18
  }
  if (input.casoLabel && !secoes) {
    texto('Caso', MARGEM + 4, y, 8.4, normal, CINZA)
    texto(input.casoLabel, MARGEM + 34, y, 8.4)
    y -= 16
  }

  const cabecalhoTabela = () => {
    texto('Data', colunas.data, y, 7.6, normal, CINZA)
    texto('Profissional', colunas.profissional, y, 7.6, normal, CINZA)
    texto('Descrição', colunas.descricao, y, 7.6, normal, CINZA)
    textoDireita('Horas', colunas.horas, y, 7.6, normal, CINZA)
    if (colunaValor) textoDireita('Valor (R$)', colunas.valor, y, 7.6, normal, CINZA)
    y -= 4
    linha(y)
    y -= 12
  }
  const limiteInferior = MARGEM + RODAPE_ALTURA
  const ALTURA_LINHA = 10

  // `fixoNaSecao`: linha dentro da mensalidade fica em branco (nem "R$ 0,00" nem "—").
  const desenharLinhas = (rows: TimesheetPdfRow[], fixoNaSecao: boolean) => {
    for (const item of rows) {
      const linhasDesc = quebrar(item.descricao || '—', normal, 8, larguraDescricao)
      const linhasProf = quebrar(
        [item.profissional, item.cargo].filter(Boolean).join(' · ') || '—',
        normal, 8, colunas.descricao - colunas.profissional - 8 - recuoNome,
      )
      // Com avatar a linha precisa de um pouco mais para os círculos não se tocarem.
      const altura = Math.max(Math.max(linhasDesc.length, linhasProf.length) * ALTURA_LINHA, comAvatar ? AVATAR - 2 : 0)
      if (y - altura < limiteInferior) {
        novaPagina()
        cabecalhoTabela()
      }
      texto(dataBR(item.data), colunas.data, y, 8)
      if (comAvatar) {
        // Topo do avatar alinhado com o topo das maiúsculas da primeira linha
        // (baseline y + ~6pt para fonte 8).
        desenharAvatar(pagina, negrito, item.profissional, item.fotoUrl ? fotos.get(item.fotoUrl) : undefined, colunas.profissional, y + 7)
      }
      linhasProf.forEach((l, i) => texto(l, colunas.profissional + recuoNome, y - i * ALTURA_LINHA, 8))
      linhasDesc.forEach((l, i) => texto(l, colunas.descricao, y - i * ALTURA_LINHA, 8))
      textoDireita(formatarHoras(item.horas), colunas.horas, y, 8)
      if (colunaValor) {
        const celula = fixoNaSecao
          ? (temValor(item.valor) ? money(Number(item.valor)) : '')
          : (item.valor != null ? money(Number(item.valor)) : '—')
        if (celula) textoDireita(celula, colunas.valor, y, 8)
      }
      y -= altura + 4
    }
  }
  const totalHoras = consolidado ? consolidado.horas : totais.horas
  // Total que vale para o quadro de impostos e a divisão por pagador.
  const totalValor = consolidado ? consolidado.total : totais.total

  if (secoes && consolidado) {
    // Uma faixa por caso, as linhas dele e o total do caso.
    secoes.forEach((s, idx) => {
      if (y - 60 < limiteInferior) novaPagina()
      pagina.drawRectangle({ x: MARGEM, y: y - 4, width: larguraUtil, height: 16, color: CINZA_CLARO })
      texto('Caso', MARGEM + 4, y, 8.4, normal, CINZA)
      texto(s.casoLabel, MARGEM + 34, y, 8.4, negrito)
      y -= 20
      cabecalhoTabela()
      desenharLinhas(s.rows, !!s.valorFixo)
      if (y - 24 < limiteInferior) novaPagina()
      const t = consolidado.porSecao[idx]
      pagina.drawLine({ start: { x: colunas.descricao, y: y + 6 }, end: { x: direita, y: y + 6 }, thickness: 0.4, color: CINZA })
      y -= 6
      texto('Total do caso', colunas.descricao, y, 8.6, negrito)
      textoDireita(formatarHoras(t.horas), colunas.horas, y, 8.6, negrito)
      if (colunaValor && (!s.valorFixo || temValor(t.valorLinhas))) textoDireita(money(t.valorLinhas), colunas.valor, y, 8.6, negrito)
      y -= 22
    })

    // Fim: total de cada caso, os valores fixos e o total geral.
    const linhasResumo = consolidado.porSecao.length + consolidado.fixos.length
    if (y - (40 + linhasResumo * 12) < limiteInferior) novaPagina()
    linha(y)
    y -= 14
    texto('Resumo', colunas.descricao, y, 9.6, negrito)
    y -= 14
    for (const s of consolidado.porSecao) {
      texto(`Caso ${s.casoLabel}`, colunas.descricao, y, 8.6)
      textoDireita(formatarHoras(s.horas), colunas.horas, y, 8.6)
      // Caso de valor fixo sem hora cobrada: em branco, como a linha dele.
      if (colunaValor && (!s.valorFixo || temValor(s.valorLinhas))) textoDireita(money(s.valorLinhas), colunas.valor, y, 8.6)
      y -= 12
    }
    for (const f of consolidado.fixos) {
      if (f.valor != null) {
        texto(`${f.rotulo} - caso ${f.casoLabel}`, colunas.descricao, y, 8.6)
        textoDireita(money(Number(f.valor)), direita, y, 8.6)
      } else {
        texto(`${f.rotulo} - caso ${f.casoLabel}: ${f.observacao || 'não incluída neste kit'}`, colunas.descricao, y, 8.6, normal, CINZA)
      }
      y -= 12
    }
    pagina.drawLine({ start: { x: colunas.descricao, y: y + 8 }, end: { x: direita, y: y + 8 }, thickness: 0.4, color: CINZA })
    y -= 4
    texto('Total geral', colunas.descricao, y, 9.6, negrito)
    textoDireita(formatarHoras(totalHoras), colunas.horas, y, 9.6, negrito)
    if (mostrarValor) textoDireita(money(totalValor), direita, y, 9.6, negrito)
    y -= 10
  } else {
    cabecalhoTabela()
    desenharLinhas(input.rows, !!valorFixo)

    // Totais: nunca sozinhos no topo da página seguinte se couber evitar.
    if (y - (valorFixo ? 80 : 40) < limiteInferior) {
      novaPagina()
    }
    y -= 4
    linha(y)
    y -= 14
    if (!valorFixo) {
      texto('Total', colunas.descricao, y, 9.6, negrito)
      textoDireita(formatarHoras(totalHoras), colunas.horas, y, 9.6, negrito)
      if (mostrarValor) textoDireita(money(totalValor), colunas.valor, y, 9.6, negrito)
      y -= 10
    } else {
      // Valor fixo: horas do mês, a mensalidade, o excedente (se houver) e o total.
      texto('Total de horas', colunas.descricao, y, 9, negrito)
      textoDireita(formatarHoras(totalHoras), colunas.horas, y, 9, negrito)
      if (colunaValor) textoDireita(money(totais.excedente), colunas.valor, y, 9, negrito)
      y -= 15
      if (valorFixo.valor != null) {
        texto(valorFixo.rotulo, colunas.descricao, y, 8.6)
        textoDireita(money(Number(valorFixo.valor)), direita, y, 8.6)
      } else {
        texto(`${valorFixo.rotulo} - ${valorFixo.observacao || 'não incluída neste kit'}`, colunas.descricao, y, 8.6, normal, CINZA)
      }
      y -= 12
      if (temValor(totais.excedente)) {
        texto(valorFixo.rotuloHoras || ROTULO_HORAS_EXCEDENTES, colunas.descricao, y, 8.6)
        textoDireita(money(totais.excedente), direita, y, 8.6)
        y -= 12
      }
      // Sem mensalidade no kit e sem excedente não há o que totalizar: a linha
      // acima já diz por quê, e um "Total R$ 0,00" leria como serviço gratuito.
      if (valorFixo.valor != null || temValor(totais.excedente)) {
        pagina.drawLine({ start: { x: colunas.descricao, y: y + 8 }, end: { x: direita, y: y + 8 }, thickness: 0.4, color: CINZA })
        y -= 4
        texto('Total', colunas.descricao, y, 9.6, negrito)
        textoDireita(money(totalValor), direita, y, 9.6, negrito)
        y -= 10
      }
    }
  }

  // Divisão por pagador (Filipe, 08/10: caso 318 Coneglian, rateio 50/50;
  // Strobel x Mendocino, pagador diferente do cliente). Fecha o relatório,
  // depois do total: nome · percentual · valor (total × percentual).
  // Com o quadro "Impostos" (abaixo), a divisão sai: o quadro já traz pagador,
  // percentual e o bruto da NFS-e, e dois valores para o mesmo pagador no
  // mesmo PDF confundem (ver layoutQuadroImpostos).
  const quadro = mostrarValor ? layoutQuadroImpostos(input.impostos, totalValor) : null
  const divisao = quadro || (valorFixo && !temValor(totalValor))
    ? null
    : divisaoPorPagador(totalValor, input.cliente, input.pagadores)
  if (divisao) {
    const ALTURA_PAGADOR = 12
    if (y - (28 + divisao.length * ALTURA_PAGADOR) < limiteInferior) {
      novaPagina()
    }
    y -= 14
    texto('Divisão por pagador', colunas.descricao, y, 9, negrito)
    y -= 5
    pagina.drawLine({ start: { x: colunas.descricao, y }, end: { x: direita, y }, thickness: 0.4, color: CINZA })
    y -= 11
    for (const d of divisao) {
      texto(d.nome, colunas.descricao, y, 8.4)
      // Valor fixo sem coluna Valor: a coluna das horas encosta na margem, então
      // o percentual recua para o valor caber à direita.
      textoDireita(percentualBR(d.percentual), mostrarValor && !colunaValor ? direita - 90 : colunas.horas, y, 8.4)
      if (mostrarValor) textoDireita(money(d.valor), colunas.valor, y, 8.4)
      y -= ALTURA_PAGADOR
    }
  }

  // Impostos por pagador (cliente, out/2026): o que cada NFS-e retém e o
  // líquido. Uma linha por pagador; sem rateio, uma linha só.
  if (quadro) {
    const ALTURA_Q = 12
    const LARGURA_NUM = 70
    const numericas = [
      { rotulo: 'Valor bruto', valor: (l: QuadroImpostosPagador) => money(l.bruto) },
      ...(quadro.colunas.length > 0
        ? quadro.colunas.map((c) => ({
            rotulo: c.rotulo,
            valor: (l: QuadroImpostosPagador) => (l.retencoes[c.chave] > 0.004 ? `- ${money(l.retencoes[c.chave])}` : '—'),
          }))
        : [{ rotulo: 'Retenções', valor: () => 'sem retenção' }]),
      { rotulo: 'Valor líquido', valor: (l: QuadroImpostosPagador) => money(l.liquido) },
    ]
    const xNum = (i: number) => direita - (numericas.length - 1 - i) * LARGURA_NUM
    const xSituacao = xNum(0) - LARGURA_NUM - 62
    const larguraNome = xSituacao - MARGEM - 8
    const linhasNome = quadro.linhas.map((l) => quebrar(
      l.percentual != null && quadro.linhas.length > 1 ? `${l.nome} (${percentualBR(l.percentual)})` : l.nome,
      normal, 8, larguraNome,
    ))
    const notasQ = quadro.notas.map((t) => quebrar(t, normal, 7, larguraUtil))
    const comTotal = quadro.linhas.length > 1
    const alturaQuadro = 34 + linhasNome.reduce((s, ls) => s + ls.length * 10 + 2, 0)
      + (comTotal ? 16 : 0) + notasQ.reduce((s, ls) => s + ls.length * 9 + 2, 0)
    if (y - alturaQuadro < limiteInferior) novaPagina()

    y -= 16
    texto('Impostos', MARGEM, y, 9, negrito)
    y -= 14
    texto('Pagador', MARGEM, y, 7.6, normal, CINZA)
    texto('Situação', xSituacao, y, 7.6, normal, CINZA)
    numericas.forEach((c, i) => textoDireita(c.rotulo, xNum(i), y, 7.6, normal, CINZA))
    y -= 4
    pagina.drawLine({ start: { x: MARGEM, y }, end: { x: direita, y }, thickness: 0.4, color: CINZA })
    y -= 11
    quadro.linhas.forEach((l, idx) => {
      linhasNome[idx].forEach((t, k) => texto(t, MARGEM, y - k * 10, 8))
      texto(quadro.situacao(l), xSituacao, y, 8, normal, l.origem === 'emitida' ? PRETO : CINZA)
      numericas.forEach((c, i) => textoDireita(c.valor(l), xNum(i), y, 8, i === numericas.length - 1 ? negrito : normal))
      y -= linhasNome[idx].length * 10 + 2
    })
    if (comTotal) {
      y -= 2
      pagina.drawLine({ start: { x: MARGEM, y: y + 8 }, end: { x: direita, y: y + 8 }, thickness: 0.4, color: CINZA })
      const soma = (f: (l: QuadroImpostosPagador) => number) => quadro.linhas.reduce((s, l) => s + f(l), 0)
      texto('Total', MARGEM, y - 2, 8.4, negrito)
      textoDireita(money(soma((l) => l.bruto)), xNum(0), y - 2, 8.4, negrito)
      if (quadro.colunas.length > 0) {
        quadro.colunas.forEach((c, i) => {
          const v = soma((l) => l.retencoes[c.chave])
          textoDireita(v > 0.004 ? `- ${money(v)}` : '—', xNum(i + 1), y - 2, 8.4, negrito)
        })
      }
      textoDireita(money(soma((l) => l.liquido)), xNum(numericas.length - 1), y - 2, 8.4, negrito)
      y -= 14
    }
    y -= 4
    for (const ls of notasQ) {
      ls.forEach((t) => { texto(t, MARGEM, y, 7, normal, CINZA); y -= 9 })
      y -= 2
    }
  }

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
