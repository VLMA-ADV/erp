// Localiza a DESPESA de origem (operations.despesas.id) de cada item de
// despesa do kit, para juntar os comprovantes na nota de débito.
//
// Bug 6.3 (Filipe, 24/09: "as despesas não estão vindo com os arquivos
// juntos"). Causa, vista em prod nas notas dos casos 1870 e 1039 de 23/09:
//   1. a Composição chamava get-revisao-fatura com `contrato=<uuid>` e
//      `caso=<uuid>`, mas a RPC get_revisao_fatura filtra p_contrato/p_caso por
//      ILIKE em nome/número — com UUID vinha lista vazia;
//   2. e lia `raw.id`, que não existe na resposta: a chave do item é
//      `billing_item_id`.
// Resultado: despesaIds sempre vazio, PDF registrado só com a página da nota
// (2 KB) mesmo com 1 e 5 comprovantes cadastrados nas despesas.
//
// Aqui a busca vai por competência + NÚMERO do caso (ou do contrato, no kit
// "Sem caso") só para encurtar a resposta; o casamento de verdade é pelo id do
// item e pelo contrato/caso do kit.

export interface LinhaRevisaoOrigem {
  billing_item_id?: string | null
  /** Compatibilidade, caso a edge um dia passe a devolver `id`. */
  id?: string | null
  origem_id?: string | null
  origem_tipo?: string | null
  contrato_id?: string | null
  caso_id?: string | null
}

export interface KitParaOrigem {
  contrato_id: string
  contrato_numero: number | null
  caso_id: string | null
  caso_numero: number | null
  /** 'YYYY-MM-01' */
  competencia: string
}

/** Query string de get-revisao-fatura para achar os itens deste kit. */
export function parametrosBuscaOrigem(kit: KitParaOrigem): URLSearchParams {
  const params = new URLSearchParams({ competencia: kit.competencia.slice(0, 7) })
  // Filtros de texto da RPC (ILIKE em número/nome): servem só para reduzir o
  // volume — a resposta ainda é conferida item a item abaixo.
  if (kit.caso_id && kit.caso_numero != null) params.set('caso', String(kit.caso_numero))
  else if (kit.contrato_numero != null) params.set('contrato', String(kit.contrato_numero))
  return params
}

/**
 * Mapa item do kit → id da despesa de origem. Ignora linhas de outro
 * contrato/caso (o filtro por número é um "contém", então 187 também traz 1870).
 */
export function mapearOrigemDasDespesas(linhas: unknown, kit: KitParaOrigem): Map<string, string> {
  const mapa = new Map<string, string>()
  if (!Array.isArray(linhas)) return mapa
  for (const raw of linhas as LinhaRevisaoOrigem[]) {
    if (!raw || typeof raw !== 'object') continue
    const itemId = raw.billing_item_id ?? raw.id
    if (!itemId || !raw.origem_id) continue
    if (raw.origem_tipo && raw.origem_tipo !== 'despesa') continue
    if (raw.contrato_id && raw.contrato_id !== kit.contrato_id) continue
    if (kit.caso_id && raw.caso_id && raw.caso_id !== kit.caso_id) continue
    mapa.set(itemId, raw.origem_id)
  }
  return mapa
}
