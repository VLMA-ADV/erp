// Avaliação prévia (pedido do cliente 26/10/2026): resumo só leitura do que já
// está gravado da avaliação anterior — skills da carreira (faixa da
// autoavaliação × faixa do gestor) e DNA VLMA (texto/faixa da autoavaliação).
// get_avaliacao_previa_pdi devolve as linhas por item; aqui o resumo por pilar.

export interface PreviaSkillItem {
  trilha: string
  pilar_numero: number
  pilar_nome: string | null
  item_codigo: string | null
  faixa_auto: string | null
  faixa_gestor: string | null
}

export interface PreviaDnaItem {
  numero: number
  nome: string
  faixa_auto: string | null
  texto_auto: string | null
}

export interface PreviaPessoa {
  colaborador_id: string
  nome: string
  avaliacao_id: string
  autoavaliacao_enviada_at: string | null
  avaliacao_gestor_enviada_at: string | null
  gestor_nome: string | null
  skills: PreviaSkillItem[]
  dna: PreviaDnaItem[]
}

export interface PreviaResposta {
  ano: number
  escopo: 'proprio' | 'area' | 'todos'
  pessoas: PreviaPessoa[]
}

export interface PilarResumo {
  trilha: string
  pilar_numero: number
  pilar_nome: string
  /** Faixas distintas dadas na autoavaliação, na ordem dos itens. */
  faixas_auto: string[]
  /** Faixas distintas dadas pelo gestor, na ordem dos itens. */
  faixas_gestor: string[]
  itens: number
}

export const TRILHA_ROTULO: Record<string, string> = {
  base: 'Skills da carreira',
  lideranca: 'Adicional — Liderança',
  estrategico: 'Adicional — Estratégico',
}

function distintas(valores: Array<string | null>): string[] {
  const out: string[] = []
  for (const v of valores) if (v && !out.includes(v)) out.push(v)
  return out
}

/**
 * Agrupa os itens de skill por trilha × pilar. Quase sempre os itens de um
 * pilar têm a mesma faixa; quando não têm, as faixas distintas aparecem todas
 * (sem inventar média). Ordem: trilha base primeiro, depois pilar.
 */
export function resumirPilares(skills: PreviaSkillItem[]): PilarResumo[] {
  const grupos = new Map<string, PreviaSkillItem[]>()
  for (const s of skills) {
    const k = `${s.trilha}|${s.pilar_numero}`
    const l = grupos.get(k) ?? []
    l.push(s)
    grupos.set(k, l)
  }
  return Array.from(grupos.values())
    .map((itens) => ({
      trilha: itens[0].trilha,
      pilar_numero: itens[0].pilar_numero,
      pilar_nome: itens[0].pilar_nome || `Pilar ${itens[0].pilar_numero}`,
      faixas_auto: distintas(itens.map((i) => i.faixa_auto)),
      faixas_gestor: distintas(itens.map((i) => i.faixa_gestor)),
      itens: itens.length,
    }))
    .sort((a, b) =>
      (a.trilha === 'base' ? 0 : 1) - (b.trilha === 'base' ? 0 : 1)
      || a.trilha.localeCompare(b.trilha)
      || a.pilar_numero - b.pilar_numero)
}

/** Índice por colaborador para o painel cruzar com as pessoas das metas. */
export function previaPorColaborador(resp: PreviaResposta | null | undefined): Map<string, PreviaPessoa> {
  const m = new Map<string, PreviaPessoa>()
  for (const p of resp?.pessoas ?? []) m.set(p.colaborador_id, p)
  return m
}
