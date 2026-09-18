import { assertEquals } from "jsr:@std/assert@1"
import { lerNumero } from "./numero-br.ts"

Deno.test("lerNumero: ponto sozinho e decimal, nao milhar (o bug da previa)", () => {
  assertEquals(lerNumero("100.00"), 100)
  assertEquals(lerNumero("2250.00"), 2250)
  assertEquals(lerNumero("8310.50"), 8310.5)
})

Deno.test("lerNumero: formatos brasileiros", () => {
  assertEquals(lerNumero("8.310,50"), 8310.5)
  assertEquals(lerNumero("8310,50"), 8310.5)
  assertEquals(lerNumero("1.234.567,89"), 1234567.89)
  assertEquals(lerNumero("R$ 1.500,00"), 1500)
})

Deno.test("lerNumero: inteiros e vazio", () => {
  assertEquals(lerNumero("100"), 100)
  assertEquals(lerNumero(" 33,33 "), 33.33)
  assertEquals(Number.isNaN(lerNumero("")), true)
  assertEquals(Number.isNaN(lerNumero(null)), true)
})
