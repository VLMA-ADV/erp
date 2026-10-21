// Sugestões de lançamento: até 5 combinações caso + descrição que a própria
// pessoa mais usou nos últimos 3 meses.
//
// Critério: agrupa por caso + descrição (descrição comparada sem diferença de
// maiúsculas/espaços), ordena pela quantidade de vezes usada e, no empate, pela
// mais recente. Só entra caso que ainda pode ser escolhido no formulário
// (contrato ativo). Descrição vazia não vira sugestão. A RPC
// get_sugestoes_timesheet devolve os candidatos já agrupados e escopados ao
// usuário; esta função decide a ordem final e corta em 5.

export const LIMITE_SUGESTOES = 5

export interface CandidatoSugestao {
  caso_id: string
  contrato_id: string
  caso_numero: number | null
  caso_nome: string | null
  descricao: string
  vezes: number
  /** data_lancamento mais recente (YYYY-MM-DD) */
  ultimo_uso: string
}

export function normalizarDescricao(texto: string) {
  return texto.trim().replace(/\s+/g, ' ').toLowerCase()
}

export function escolherSugestoes(
  candidatos: CandidatoSugestao[],
  casoDisponivel: (casoId: string) => boolean,
  limite = LIMITE_SUGESTOES,
): CandidatoSugestao[] {
  const porChave = new Map<string, CandidatoSugestao>()
  for (const c of candidatos) {
    const desc = normalizarDescricao(c.descricao || '')
    if (!desc || !c.caso_id || !casoDisponivel(c.caso_id)) continue
    const chave = `${c.caso_id}|${desc}`
    const atual = porChave.get(chave)
    const limpo = { ...c, descricao: c.descricao.trim(), vezes: Number(c.vezes) || 0 }
    if (!atual) {
      porChave.set(chave, limpo)
      continue
    }
    // Mesma combinação com grafia diferente: soma as vezes e mostra a grafia
    // usada por último.
    const maisRecente = limpo.ultimo_uso > atual.ultimo_uso
    porChave.set(chave, {
      ...(maisRecente ? limpo : atual),
      vezes: atual.vezes + limpo.vezes,
    })
  }
  return Array.from(porChave.values())
    .sort((a, b) => b.vezes - a.vezes || b.ultimo_uso.localeCompare(a.ultimo_uso))
    .slice(0, limite)
}
