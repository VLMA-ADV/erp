import { assertEquals } from "jsr:@std/assert@1"
import { resumoValorHora } from "./valor-hora.ts"

// Intl no Deno usa NBSP entre "R$" e o número; comparamos sem depender disso.
const semEspaco = (s: string | null) => (s === null ? null : s.replace(/\s/g, ""))

Deno.test("resumoValorHora: valor unico", () => {
  assertEquals(semEspaco(resumoValorHora([{ valor_hora: 450 }, { valor_hora: "450" }])), "R$450,00/h")
})

Deno.test("resumoValorHora: faixa quando ha tabela por cargo", () => {
  assertEquals(
    semEspaco(resumoValorHora([{ valor_hora: 600 }, { valor_hora: 350 }, { valor_hora: 450 }])),
    "R$350,00–R$600,00/h",
  )
})

Deno.test("resumoValorHora: sem valores devolve null", () => {
  assertEquals(resumoValorHora([]), null)
  assertEquals(resumoValorHora(undefined), null)
  assertEquals(resumoValorHora(null), null)
  assertEquals(resumoValorHora([{}, { valor_hora: null }]), null)
})

Deno.test("resumoValorHora: zeros sao ignorados (caso mensal)", () => {
  assertEquals(resumoValorHora([{ valor_hora: 0 }, { valor_hora: "0" }]), null)
  assertEquals(semEspaco(resumoValorHora([{ valor_hora: 0 }, { valor_hora: 300 }])), "R$300,00/h")
})
