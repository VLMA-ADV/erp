// "Valor da hora" da mensalidade de carteira (cliente, out/2026: "mensalidade
// de carteira cobrando por hora").
//
// Fica dentro da regra mensalidade_carteira da MATRIZ, em
// regra_cobranca_config.valor_hora_carteira (string decimal com ponto, como
// os outros valores da regra: "350.00"). Com ele, toda hora da carteira — da
// matriz e dos processos ligados a ela (casos.parte_de_carteira_id) — é
// cobrada por esse valor e SOMA com a mensalidade. Vazio = como sempre: a
// hora da carteira é registro de trabalho, a R$ 0,00.
//
// Quem cobra é o banco (public.valor_hora_carteira, chamada por
// public.resolver_valor_hora); aqui só a forma de guardar e validar.

export const CHAVE_VALOR_HORA_CARTEIRA = 'valor_hora_carteira'

/** Número > 0 ou null (vazio, zero, inválido). Aceita "350.00" e "350,00". */
export function valorHoraCarteiraNumero(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const texto = String(value).trim()
  if (!texto) return null
  const n = Number(texto.replace(',', '.'))
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null
}

/**
 * Valor a gravar na regra: "350.00", ou null para "sem valor de hora".
 * O MoneyInput devolve "0.00" quando a pessoa apaga o campo — isso é vazio,
 * não uma hora de graça cadastrada de propósito.
 */
export function normalizarValorHoraCarteira(value: unknown): string | null {
  const n = valorHoraCarteiraNumero(value)
  return n === null ? null : n.toFixed(2)
}

/** Mensagem de erro do campo, ou null quando ok (vazio também é ok). */
export function erroValorHoraCarteira(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const texto = String(value).trim()
  if (!texto) return null
  const n = Number(texto.replace(',', '.'))
  if (!Number.isFinite(n)) return 'Valor da hora da carteira inválido'
  if (n < 0) return 'Valor da hora da carteira deve ser maior que zero'
  return null
}
