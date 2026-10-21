// Aba/linha de regra de cobrança de um item da Revisão de fatura.
//
// Usado nas abas (Todas, Horas, Mensalidade...) e nas linhas do painel
// "Andamento por regra". A mesma chave sai da RPC get_faturado_mes_por_regra
// (coluna "Faturado no mês"), então as duas listas precisam andar juntas.
//
// Mensalidade de carteira tem aba própria desde 10/2026 (Filipe, 29/09: "na
// regra de cobrança 'mensalidade de carteira' queria que tivesse uma aba aqui
// no faturamento"). Antes os itens dela caíam em "Sem regra" e só apareciam
// em Todas.

export type RuleFilterKey =
  | 'all'
  | 'hora'
  | 'mensalidade_processo'
  | 'mensalidade'
  | 'mensalidade_carteira'
  | 'projeto'
  | 'projeto_parcelado'
  | 'exito'
  | 'despesa'
  // "Sem regra": só filtro interno (clique no painel), não vira aba.
  | 'outros'

export interface RegraFiltroItem {
  origemTipo: string
  /** regra gravada no item (snapshot.regra_cobranca) */
  regraItem?: string | null
  /** regra atual do caso */
  casoRegraCobranca?: string | null
}

/** Abas na ordem da tela (sem 'all' e sem 'outros'). */
export const ABAS_DE_REGRA: Exclude<RuleFilterKey, 'all' | 'outros'>[] = [
  'hora',
  'mensalidade_processo',
  'mensalidade',
  'mensalidade_carteira',
  'projeto',
  'projeto_parcelado',
  'exito',
  'despesa',
]

/** Linhas do painel "Andamento por regra" (abas + "Sem regra"). */
export const LINHAS_DO_PAINEL: Exclude<RuleFilterKey, 'all'>[] = [...ABAS_DE_REGRA, 'outros']

const norm = (v: string | null | undefined) => (v || '').trim().toLowerCase()

// Aba pela regra do caso: hora lançada em caso que não é hora pura
// cai na aba da regra (mensalidade de processo, carteira, projeto, êxito...).
function ruleKeyFromKind(kind: string): RuleFilterKey | null {
  if (kind === 'mensalidade_processo' || kind === 'salario_minimo') return 'mensalidade_processo'
  if (kind === 'mensal') return 'mensalidade'
  if (kind === 'mensalidade_carteira') return 'mensalidade_carteira'
  if (kind === 'projeto' || kind === 'pro_labore') return 'projeto'
  if (kind === 'projeto_parcela' || kind === 'projeto_parcelado' || kind === 'pro_labore_parcelado') return 'projeto_parcelado'
  if (kind === 'exito') return 'exito'
  return null
}

// Item sem regra reconhecida cai em 'outros' ("Sem regra" no painel): aparece
// em Todas e pode ser filtrado pelo clique no painel, mas não tem aba.
export function getRuleFilterKey(item: RegraFiltroItem): RuleFilterKey {
  if (item.origemTipo === 'despesa') return 'despesa'
  const kind = norm(item.regraItem)
  const casoKind = norm(item.casoRegraCobranca)
  if (item.origemTipo === 'timesheet') {
    const mapped = ruleKeyFromKind(casoKind)
    if (mapped) return mapped
    // aba Horas é exclusiva de casos que cobram por hora; sem regra => só em Todas
    return casoKind === 'hora' || casoKind === 'hora_com_cap' ? 'hora' : 'outros'
  }
  if (kind === 'hora' || kind === 'hora_com_cap') return 'hora'
  if (kind === 'salario_minimo') return 'outros' // regra de item: só pelo caso (comportamento anterior)
  return ruleKeyFromKind(kind) ?? 'outros'
}

export function getRuleFilterLabel(key: RuleFilterKey) {
  switch (key) {
    case 'all':
      return 'Todas'
    case 'hora':
      return 'Horas'
    case 'mensalidade_processo':
      return 'Mensalidade de processo'
    case 'mensalidade':
      return 'Mensalidade'
    case 'mensalidade_carteira':
      return 'Mensalidade de carteira'
    case 'projeto':
      return 'Projeto'
    case 'projeto_parcelado':
      return 'Projeto parcelado'
    case 'exito':
      return 'Êxito'
    case 'despesa':
      return 'Despesas'
    case 'outros':
      return 'Sem regra'
  }
}
