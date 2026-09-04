/// <reference lib="dom" />
// Ficha de compensação do boleto Itaú (341), para imprimir ou salvar em PDF.
//
// O Itaú registra o título e devolve linha digitável, código de barras e Pix;
// o papel é nosso. Mesmo padrão dos outros documentos do sistema (relatório de
// timesheet, nota de débito): HTML aberto em aba nova com window.print().
//
// O código de barras é desenhado aqui, em SVG, no padrão que os bancos usam
// (Interleaved 2 of 5) — sem biblioteca externa. `codigoBarrasItf` é puro e
// testado em boleto-ficha.test.ts (deno test).
//
// Este arquivo é lido pelo Deno no teste, por isso o cliente Supabase e o
// papel timbrado entram por import dinâmico dentro de `abrirFichaBoleto`:
// import estático com alias "@/..." não resolve fora do Next.

/** Shape devolvido por public.bol_ficha(p_user_id, p_boleto_id). */
export interface BolFicha {
  boleto: {
    id: string
    nosso_numero: string | number
    seu_numero: string | null
    valor: number
    vencimento: string
    data_emissao: string
    status: string
    linha_digitavel: string
    codigo_barras: string
    pix_copia_cola: string | null
  }
  pagador: {
    nome: string
    documento: string
    logradouro: string | null
    bairro: string | null
    cidade: string | null
    uf: string | null
    cep: string | null
  }
  beneficiario: {
    cnpj: string
    agencia: string
    conta: string
    carteira: string
    especie: string
  }
  descricao: string
  nota_numero: number | null
  instrucoes: string[]
}

/** Resumo devolvido por bol_da_nota / bol_do_lancamento (null = sem boleto). */
export interface BolResumo {
  id: string
  status: string
  valor: number
  vencimento: string
  linha_digitavel: string | null
  pix_copia_cola: string | null
  codigo_barras?: string | null
}

// ── Interleaved 2 of 5 ────────────────────────────────────────────────

/** Um elemento do código: barra (preta) ou espaço (branco), largo ou estreito. */
export interface ElementoItf {
  largo: boolean
  barra: boolean
}

// Cada dígito são 5 elementos, dois deles largos (1). Tabela do padrão.
const ITF_DIGITOS: Record<string, string> = {
  '0': '00110',
  '1': '10001',
  '2': '01001',
  '3': '11000',
  '4': '00101',
  '5': '10100',
  '6': '01100',
  '7': '00011',
  '8': '10010',
  '9': '01010',
}

/**
 * Sequência de barras e espaços do ITF-25 para uma string de dígitos.
 *
 * Start "0000" (barra, espaço, barra, espaço — todos estreitos), depois os
 * dígitos aos pares — o primeiro vira as barras, o segundo os espaços,
 * intercalados —, e stop "100" (barra larga, espaço estreito, barra estreita).
 * Por isso a quantidade de dígitos tem de ser par: 44 no boleto.
 */
export function codigoBarrasItf(digitos: string): ElementoItf[] {
  const s = String(digitos ?? '').trim()
  if (!/^\d+$/.test(s)) throw new Error('Código de barras deve conter apenas dígitos.')
  if (s.length % 2 !== 0) throw new Error('ITF-25 exige quantidade par de dígitos.')

  const out: ElementoItf[] = [
    { largo: false, barra: true },
    { largo: false, barra: false },
    { largo: false, barra: true },
    { largo: false, barra: false },
  ]
  for (let i = 0; i < s.length; i += 2) {
    const barras = ITF_DIGITOS[s[i]]
    const espacos = ITF_DIGITOS[s[i + 1]]
    for (let j = 0; j < 5; j++) {
      out.push({ largo: barras[j] === '1', barra: true })
      out.push({ largo: espacos[j] === '1', barra: false })
    }
  }
  out.push({ largo: true, barra: true })
  out.push({ largo: false, barra: false })
  out.push({ largo: false, barra: true })
  return out
}

/**
 * SVG do código de barras. Proporção 1:3 entre estreito e largo; a largura
 * vem em unidades de "estreito" e o SVG é esticado até `larguraMm` x
 * `alturaMm` (13mm é o que a Febraban pede para a ficha de compensação).
 */
export function svgCodigoBarras(digitos: string, larguraMm = 103, alturaMm = 13): string {
  const elementos = codigoBarrasItf(digitos)
  const total = elementos.reduce((s, e) => s + (e.largo ? 3 : 1), 0)
  let x = 0
  const rects: string[] = []
  for (const e of elementos) {
    const w = e.largo ? 3 : 1
    if (e.barra) rects.push(`<rect x="${x}" y="0" width="${w}" height="100"/>`)
    x += w
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} 100" width="${larguraMm}mm" height="${alturaMm}mm" preserveAspectRatio="none" shape-rendering="crispEdges" fill="#000" aria-label="Código de barras ${digitos}">${rects.join('')}</svg>`
}

// ── Formatação ────────────────────────────────────────────────────────

const escHtml = (s: unknown) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const reais = (v: number) =>
  new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v || 0))

const dataBR = (v?: string | null) =>
  v && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10).split('-').reverse().join('/') : (v || '')

/** 47 dígitos → "AAABC.CCDDD DDDDD.DDDDDD DDDDD.DDDDDD E FFFFGGGGGGGGGG". */
export function formatarLinhaDigitavel(linha: string | null | undefined): string {
  const d = String(linha ?? '').replace(/\D/g, '')
  if (d.length !== 47) return String(linha ?? '')
  return `${d.slice(0, 5)}.${d.slice(5, 10)} ${d.slice(10, 15)}.${d.slice(15, 21)} ${d.slice(21, 26)}.${d.slice(26, 32)} ${d.slice(32, 33)} ${d.slice(33, 47)}`
}

/** CPF ou CNPJ com pontuação, a partir de só dígitos. */
export function formatarDocumento(doc: string | null | undefined): string {
  const d = String(doc ?? '').replace(/\D/g, '')
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
  return String(doc ?? '')
}

const formatarCep = (cep: string | null | undefined) => {
  const d = String(cep ?? '').replace(/\D/g, '')
  return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : String(cep ?? '')
}

// ── HTML da ficha ─────────────────────────────────────────────────────

export interface EmitenteFicha {
  nome: string
}

/**
 * Monta a página inteira da ficha de compensação. Pura: recebe os dados e o
 * nome do beneficiário, devolve o HTML. Quem chama abre em aba nova.
 */
export function montarFichaBoletoHtml(ficha: BolFicha, emitente: EmitenteFicha): string {
  const b = ficha.boleto
  const p = ficha.pagador
  const ben = ficha.beneficiario
  const linha = formatarLinhaDigitavel(b.linha_digitavel)
  const venc = dataBR(b.vencimento)
  const valor = reais(b.valor)
  const nossoNumero = `${ben.carteira}/${String(b.nosso_numero ?? '')}`
  const agConta = `${ben.agencia} / ${ben.conta}`
  const enderecoPagador = [
    p.logradouro,
    p.bairro,
  ].filter(Boolean).join(' - ')
  const cidadePagador = [
    [p.cidade, p.uf].filter(Boolean).join(' - '),
    formatarCep(p.cep),
  ].filter(Boolean).join('  CEP ')
  const instrucoes = (ficha.instrucoes || []).filter(Boolean)
  const barras = svgCodigoBarras(b.codigo_barras)
  const titulo = `Boleto ${b.nosso_numero}${ficha.nota_numero ? ` - NF ${ficha.nota_numero}` : ''}`

  const campo = (rotulo: string, valorHtml: string, cls = '') =>
    `<td class="c ${cls}"><span class="r">${escHtml(rotulo)}</span><span class="v">${valorHtml}</span></td>`

  const cabecalho = `
    <div class="cab">
      <div class="banco"><span class="logo">Itaú</span><span class="cod">341-7</span></div>
      <div class="linha">${escHtml(linha)}</div>
    </div>`

  const beneficiarioHtml = `${escHtml(emitente.nome)}<br><small>CNPJ ${escHtml(formatarDocumento(ben.cnpj))}</small>`

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8" />
<title>${escHtml(titulo)}</title>
<style>
  @page { size: A4 portrait; margin: 12mm 14mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; background: #fff; font-size: 8pt; margin: 0; padding: 4mm 0; }
  .folha { width: 182mm; margin: 0 auto; }

  .cab { display: flex; align-items: flex-end; border-bottom: 2px solid #111; padding-bottom: 1mm; gap: 4mm; }
  .banco { display: flex; align-items: baseline; gap: 2mm; padding-right: 3mm; border-right: 2px solid #111; }
  .banco .logo { font-size: 20pt; font-weight: bold; color: #EC7000; letter-spacing: -.5px; }
  .banco .cod { font-size: 14pt; font-weight: bold; }
  .cab .linha { flex: 1; text-align: right; font-size: 11.5pt; font-weight: bold; font-family: "Courier New", Courier, monospace; letter-spacing: .2px; white-space: nowrap; }

  table.ficha { width: 100%; border-collapse: collapse; table-layout: fixed; }
  table.ficha td.c { border-bottom: 1px solid #111; border-right: 1px solid #111; padding: .8mm 1.4mm .6mm; vertical-align: top; height: 9mm; }
  table.ficha td.c:last-child { border-right: 0; }
  table.ficha td.c .r { display: block; font-size: 6pt; color: #333; margin-bottom: .5mm; }
  table.ficha td.c .v { display: block; font-size: 8.5pt; }
  table.ficha td.c.dir .v { text-align: right; }
  table.ficha td.c.forte .v { font-weight: bold; font-size: 9.5pt; }
  table.ficha td.c.alta { height: 24mm; }
  table.ficha td.c small { font-size: 7pt; color: #333; }
  .col-dir { width: 46mm; }
  .col-dir .c { border-left: 1px solid #111; }

  .instr { white-space: pre-line; line-height: 1.4; }
  .pagador .v { line-height: 1.4; }

  .rodape { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 3mm; }
  .rodape .aut { font-size: 6.5pt; color: #333; text-align: right; }

  .recibo { margin-bottom: 6mm; }
  .recibo h2 { font-size: 8pt; font-weight: normal; margin: 0 0 1mm; color: #333; }
  .corte { border: 0; border-top: 1px dashed #111; margin: 4mm 0 3mm; }
  .corte-txt { font-size: 6.5pt; color: #333; text-align: right; margin-top: -2mm; margin-bottom: 3mm; }

  .pix { margin-top: 6mm; border: 1px solid #111; padding: 2mm 2.5mm; }
  .pix .r { font-size: 6.5pt; color: #333; display: block; margin-bottom: 1mm; }
  .pix .v { font-family: "Courier New", Courier, monospace; font-size: 7.5pt; word-break: break-all; line-height: 1.4; }

  .barra { margin: 0 auto 5mm; width: 182mm; }
  .barra button { background: #E8871E; color: #fff; border: 0; border-radius: 999px; padding: 8px 18px; font-size: 11pt; cursor: pointer; font-family: inherit; }
  @media print { .barra { display: none; } }
</style></head><body>

<div class="barra"><button onclick="window.print()">Imprimir / salvar PDF</button></div>

<div class="folha">

  <!-- Recibo do pagador: resumo que fica com quem paga. -->
  <div class="recibo">
    ${cabecalho}
    <table class="ficha">
      <tr>
        ${campo('Beneficiário', beneficiarioHtml)}
        ${campo('Agência / Código do beneficiário', escHtml(agConta), 'dir')}
      </tr>
      <tr>
        ${campo('Pagador', `${escHtml(p.nome)} — ${escHtml(formatarDocumento(p.documento))}`)}
        ${campo('Vencimento', escHtml(venc), 'dir forte')}
      </tr>
      <tr>
        ${campo('Nosso número', escHtml(nossoNumero))}
        ${campo('(=) Valor do documento', `R$ ${escHtml(valor)}`, 'dir forte')}
      </tr>
    </table>
    <div class="rodape"><span></span><span class="aut">Autenticação mecânica — Recibo do pagador</span></div>
  </div>

  <hr class="corte" />
  <div class="corte-txt">Corte na linha pontilhada</div>

  <!-- Ficha de compensação: o que o banco lê. -->
  ${cabecalho}
  <table class="ficha">
    <colgroup>
      <col /><col /><col /><col /><col /><col class="col-dir" />
    </colgroup>
    <tr>
      ${campo('Local de pagamento', 'Pagável em qualquer banco até o vencimento').replace('<td class="c ', '<td colspan="5" class="c ')}
      ${campo('Vencimento', escHtml(venc), 'dir forte')}
    </tr>
    <tr>
      ${campo('Beneficiário', beneficiarioHtml).replace('<td class="c ', '<td colspan="5" class="c ')}
      ${campo('Agência / Código do beneficiário', escHtml(agConta), 'dir')}
    </tr>
    <tr>
      ${campo('Data do documento', escHtml(dataBR(b.data_emissao)))}
      ${campo('Nº do documento', escHtml(b.seu_numero ?? ''))}
      ${campo('Espécie doc.', 'DM')}
      ${campo('Aceite', 'N')}
      ${campo('Data do processamento', escHtml(dataBR(b.data_emissao)))}
      ${campo('Nosso número', escHtml(nossoNumero), 'dir')}
    </tr>
    <tr>
      ${campo('Uso do banco', '')}
      ${campo('Carteira', escHtml(ben.carteira))}
      ${campo('Espécie', 'R$')}
      ${campo('Quantidade', '')}
      ${campo('(x) Valor', '')}
      ${campo('(=) Valor do documento', `R$ ${escHtml(valor)}`, 'dir forte')}
    </tr>
    <tr>
      <td colspan="5" class="c alta" rowspan="5">
        <span class="r">Instruções (texto de responsabilidade do beneficiário)</span>
        <span class="v instr">${escHtml(ficha.descricao)}${instrucoes.length ? '\n' + instrucoes.map(escHtml).join('\n') : ''}</span>
      </td>
      ${campo('(-) Desconto / Abatimento', '', 'dir')}
    </tr>
    <tr>${campo('(-) Outras deduções', '', 'dir')}</tr>
    <tr>${campo('(+) Mora / Multa', '', 'dir')}</tr>
    <tr>${campo('(+) Outros acréscimos', '', 'dir')}</tr>
    <tr>${campo('(=) Valor cobrado', '', 'dir')}</tr>
    <tr>
      <td colspan="6" class="c pagador">
        <span class="r">Pagador</span>
        <span class="v">
          <strong>${escHtml(p.nome)}</strong> — ${escHtml(formatarDocumento(p.documento))}<br>
          ${escHtml(enderecoPagador)}<br>
          ${escHtml(cidadePagador)}
        </span>
      </td>
    </tr>
    <tr>
      <td colspan="6" class="c" style="border-bottom:0;height:6mm">
        <span class="r">Sacador / Avalista</span>
        <span class="v"></span>
      </td>
    </tr>
  </table>

  <div class="rodape">
    <div class="barras">${barras}</div>
    <span class="aut">Autenticação mecânica — Ficha de compensação</span>
  </div>

  ${b.pix_copia_cola ? `<div class="pix">
    <span class="r">Pix copia e cola</span>
    <span class="v">${escHtml(b.pix_copia_cola)}</span>
  </div>` : ''}

</div>
</body></html>`
}

// ── Abertura a partir da tela ─────────────────────────────────────────

/**
 * Busca a ficha no banco (bol_ficha) e abre em aba nova pronta para imprimir.
 * Devolve a mensagem de erro quando não deu; null quando abriu.
 *
 * A aba é aberta ANTES da consulta: navegadores bloqueiam window.open que
 * acontece depois de um await, longe do clique.
 */
export async function abrirFichaBoleto(boletoId: string): Promise<string | null> {
  const win = window.open('', '_blank')
  if (win) {
    win.document.write('<!doctype html><title>Boleto</title><p style="font-family:Arial;padding:16px">Montando o boleto…</p>')
  }
  try {
    const { createClient } = await import('@/lib/supabase/client')
    const { ESCRITORIO } = await import('./documento-vlma')
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('Sessão expirada.')
    const { data, error } = await supabase.rpc('bol_ficha', { p_user_id: user.id, p_boleto_id: boletoId })
    if (error) throw new Error(error.message)
    const ficha = data as BolFicha | null
    if (!ficha?.boleto?.codigo_barras || !ficha.boleto.linha_digitavel) {
      throw new Error('Este boleto ainda não tem código de barras registrado.')
    }
    const html = montarFichaBoletoHtml(ficha, { nome: ESCRITORIO.razao })
    if (!win) return 'O navegador bloqueou a aba do boleto. Libere pop-ups para este site.'
    win.document.open()
    win.document.write(html)
    win.document.close()
    return null
  } catch (err) {
    win?.close()
    return err instanceof Error ? err.message : 'Não foi possível abrir o boleto.'
  }
}

/** Copia texto para a área de transferência; false quando o navegador não deixa. */
export async function copiarTexto(texto: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto)
    return true
  } catch {
    return false
  }
}
