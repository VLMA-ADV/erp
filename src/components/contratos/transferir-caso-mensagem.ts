// Retorno da RPC public.transferir_caso (migration 20261021100000).
export interface ResultadoTransferenciaCaso {
  itens_movidos?: number | null
  lancamentos_movidos?: number | null
  despesas_movidas?: number | null
  kits_movidos?: number | null
  itens_faturados_mantidos?: number | null
}

const n = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const plural = (q: number, um: string, varios: string) => `${q} ${q === 1 ? um : varios}`

/** Texto do toast depois de transferir o caso: o que foi junto e o que ficou. */
export function mensagemTransferenciaCaso(r: ResultadoTransferenciaCaso | null | undefined): string {
  if (!r) return 'Caso transferido'
  const foram: string[] = []
  const lanc = n(r.lancamentos_movidos)
  const itens = n(r.itens_movidos)
  const desp = n(r.despesas_movidas)
  const kits = n(r.kits_movidos)
  if (lanc) foram.push(plural(lanc, 'lançamento', 'lançamentos'))
  if (itens) foram.push(plural(itens, 'item de faturamento', 'itens de faturamento'))
  if (desp) foram.push(plural(desp, 'despesa', 'despesas'))
  if (kits) foram.push(plural(kits, 'kit aberto', 'kits abertos'))

  let msg = 'Caso transferido'
  if (foram.length) {
    const lista = foram.length === 1 ? foram[0] : `${foram.slice(0, -1).join(', ')} e ${foram[foram.length - 1]}`
    msg += ` com ${lista}`
  }
  msg += '.'
  const fat = n(r.itens_faturados_mantidos)
  if (fat) {
    msg += ` ${fat === 1 ? '1 item faturado ficou' : `${fat} itens faturados ficaram`} no contrato anterior.`
  }
  return msg
}
