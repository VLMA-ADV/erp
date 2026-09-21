// Valor da hora de um conjunto de linhas, para a conferência manual (Filipe,
// 01/09). Só as linhas de hora têm taxa; mensalidade e parcela vêm sem.
//
// Quando o caso tem tabela por cargo, a taxa muda de pessoa para pessoa — aí
// mostramos a faixa em vez de um número só. Exibir apenas o primeiro seria
// pior que não exibir: pareceria "a regra do caso" e não é.
//
// Compartilhado entre a etapa 1 (itens a faturar) e a revisão de fatura, para
// as duas telas mostrarem o mesmo texto para os mesmos números.

const formatMoney = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)

export function resumoValorHora(
  linhas: Array<{ valor_hora?: number | string | null }> | undefined | null,
): string | null {
  const taxas = (linhas || [])
    .map((l) => Number(l.valor_hora || 0))
    .filter((v) => Number.isFinite(v) && v > 0)
  if (taxas.length === 0) return null
  const menor = Math.min(...taxas)
  const maior = Math.max(...taxas)
  return menor === maior
    ? `${formatMoney(menor)}/h`
    : `${formatMoney(menor)}–${formatMoney(maior)}/h`
}
