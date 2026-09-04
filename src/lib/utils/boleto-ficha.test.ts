/**
 * Testes do código de barras ITF-25 da ficha do boleto.
 * Rodar: deno test src/lib/utils/boleto-ficha.test.ts
 */
import { assertEquals, assertThrows } from "jsr:@std/assert@1"
import {
  codigoBarrasItf,
  formatarDocumento,
  formatarLinhaDigitavel,
  montarFichaBoletoHtml,
  svgCodigoBarras,
  type BolFicha,
} from "./boleto-ficha.ts"

// Exemplo real da colecao Postman do Itau (mesmo de boleto-payload.test.ts).
const CODIGO = "34191942700000300001570000796551500572639000"

Deno.test("start e uma sequencia de quatro elementos estreitos (0000)", () => {
  const el = codigoBarrasItf("00")
  assertEquals(el.slice(0, 4), [
    { largo: false, barra: true },
    { largo: false, barra: false },
    { largo: false, barra: true },
    { largo: false, barra: false },
  ])
})

Deno.test("stop e barra larga, espaco estreito, barra estreita (100)", () => {
  const el = codigoBarrasItf("00")
  assertEquals(el.slice(-3), [
    { largo: true, barra: true },
    { largo: false, barra: false },
    { largo: false, barra: true },
  ])
})

Deno.test("cada par de digitos vira 10 elementos intercalados: barras do primeiro, espacos do segundo", () => {
  // 3 = 11000 (barras), 7 = 00011 (espacos)
  const el = codigoBarrasItf("37").slice(4, 14)
  assertEquals(el.map((e) => e.barra), [true, false, true, false, true, false, true, false, true, false])
  assertEquals(el.filter((e) => e.barra).map((e) => e.largo), [true, true, false, false, false])
  assertEquals(el.filter((e) => !e.barra).map((e) => e.largo), [false, false, false, true, true])
})

Deno.test("44 digitos geram 4 + 44*5 + 3 = 227 elementos, alternando barra e espaco", () => {
  const el = codigoBarrasItf(CODIGO)
  assertEquals(el.length, 227)
  assertEquals(el[0].barra, true)
  assertEquals(el[el.length - 1].barra, true)
  for (let i = 1; i < el.length; i++) assertEquals(el[i].barra, !el[i - 1].barra)
  // Cada digito tem exatamente 2 elementos largos; start nao tem; stop tem 1.
  assertEquals(el.filter((e) => e.largo).length, 44 * 2 + 1)
})

Deno.test("recusa quantidade impar de digitos e caracteres que nao sao digitos", () => {
  assertThrows(() => codigoBarrasItf("123"), Error, "par")
  assertThrows(() => codigoBarrasItf("12a4"), Error, "dígitos")
  assertThrows(() => codigoBarrasItf(""), Error)
})

Deno.test("svg tem um rect por barra e largura total na proporcao 1:3", () => {
  const svg = svgCodigoBarras(CODIGO)
  const rects = svg.match(/<rect /g) || []
  assertEquals(rects.length, 114) // (227 + 1) / 2 barras
  // Unidades: 227 elementos, 89 largos (3) + 138 estreitos (1) = 405.
  assertEquals(svg.includes('viewBox="0 0 405 100"'), true)
  assertEquals(svg.includes('height="13mm"'), true)
})

Deno.test("linha digitavel e documentos ganham a pontuacao padrao", () => {
  assertEquals(
    formatarLinhaDigitavel("34191570070079655150505726390007194270000030000"),
    "34191.57007 00796.551505 05726.390007 1 94270000030000",
  )
  assertEquals(formatarLinhaDigitavel("123"), "123")
  assertEquals(formatarDocumento("26556923222"), "265.569.232-22")
  assertEquals(formatarDocumento("14491612000139"), "14.491.612/0001-39")
})

Deno.test("ficha traz os campos do boleto e escapa HTML do pagador", () => {
  const ficha: BolFicha = {
    boleto: {
      id: "b1", nosso_numero: "00000001", seu_numero: "41", valor: 1234.5,
      vencimento: "2026-09-30", data_emissao: "2026-09-04", status: "registrado",
      linha_digitavel: "34191570070079655150505726390007194270000030000",
      codigo_barras: CODIGO, pix_copia_cola: "00020101br.gov.bcb.pix",
    },
    pagador: {
      nome: "Cliente <Teste>", documento: "26556923222", logradouro: "Rua A, 1",
      bairro: "Centro", cidade: "Curitiba", uf: "PR", cep: "80000000",
    },
    beneficiario: { cnpj: "14491612000139", agencia: "3835", conta: "31141-0", carteira: "109", especie: "17" },
    descricao: "Honorarios setembro",
    nota_numero: 41,
    instrucoes: ["Nao receber apos o vencimento"],
  }
  const html = montarFichaBoletoHtml(ficha, { nome: "Escritorio" })
  assertEquals(html.includes("Cliente &lt;Teste&gt;"), true)
  assertEquals(html.includes("30/09/2026"), true)
  assertEquals(html.includes("R$ 1.234,50"), true)
  assertEquals(html.includes("109/00000001"), true)
  assertEquals(html.includes("3835 / 31141-0"), true)
  assertEquals(html.includes("Pix copia e cola"), true)
  assertEquals(html.includes("80000-000"), true)
  assertEquals(html.includes("<svg"), true)
})

// Decodificador so para o teste: le a sequencia de volta e tem de achar os
// mesmos 44 digitos. Se a tabela ou a intercalacao estivessem trocadas, o
// leitor do banco leria outro numero — e o cliente pagaria outro boleto.
function decodificarItf(el: ReturnType<typeof codigoBarrasItf>): string {
  const tabela: Record<string, string> = {
    "00110": "0", "10001": "1", "01001": "2", "11000": "3", "00101": "4",
    "10100": "5", "01100": "6", "00011": "7", "10010": "8", "01010": "9",
  }
  const miolo = el.slice(4, -3)
  let out = ""
  for (let i = 0; i < miolo.length; i += 10) {
    const par = miolo.slice(i, i + 10)
    const barras = par.filter((e) => e.barra).map((e) => (e.largo ? "1" : "0")).join("")
    const espacos = par.filter((e) => !e.barra).map((e) => (e.largo ? "1" : "0")).join("")
    out += tabela[barras] + tabela[espacos]
  }
  return out
}

Deno.test("ida e volta: a sequencia de barras reconstitui os 44 digitos", () => {
  assertEquals(decodificarItf(codigoBarrasItf(CODIGO)), CODIGO)
  assertEquals(decodificarItf(codigoBarrasItf("0123456789")), "0123456789")
})
