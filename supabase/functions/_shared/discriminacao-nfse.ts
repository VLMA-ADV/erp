// Discriminação (descricao_servico) da NFS-e: linha "Competência do serviço"
// e limite de caracteres. Sem imports, para rodar com `deno test` puro.
//
// FONTE DA REGRA: src/lib/faturamento/competencia-do-servico.ts (e o par do
// front, src/lib/faturamento/discriminacao-nfse.ts). A edge não importa de
// src/, então a regra está duplicada aqui — mudou lá, muda aqui.
//
// Pedido do cliente (out/2026): a nota diz no TEXTO o mês em que o serviço
// foi prestado. A data de competência fiscal (data_competencia) NÃO muda.
// Horas, despesas e mensalidade ('mensal', 'mensalidade_carteira') do kit de
// outubro são o serviço de setembro (competência do kit − 1); projeto,
// pró-labore, salário mínimo, mensalidade de processo, êxito e demais regras
// ficam no próprio mês. Nota com naturezas misturadas usa o mês das
// horas/mensalidade (kit − 1).

/** Limite do campo xDescServ da NFS-e Nacional (TSDesc2000, até 2000 caracteres). */
export const LIMITE_DISCRIMINACAO_NFSE = 2000

export const ROTULO_COMPETENCIA_SERVICO = "Competência do serviço"

const MESES_PT = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
]

/** Naturezas cujo serviço é o do mês anterior ao da competência do kit. */
const COBRADAS_NO_MES_SEGUINTE = new Set<string>(["timesheet", "despesa", "mensal", "mensalidade_carteira"])

/**
 * Natureza do item a partir do snapshot do billing_item (é o que
 * get_billing_items_aprovados_escopo devolve): snapshot.origem é o
 * origem_tipo ('timesheet', 'despesa', 'regra_financeira'); nas regras,
 * snapshot.regra_cobranca diz qual ('mensal', 'projeto'...). Snapshot antigo
 * sem 'origem' mas com campos timesheet_* é hora.
 */
export function naturezaDoItem(snapshot: Record<string, unknown> | null | undefined): string {
  const s = snapshot ?? {}
  const origem = String(s.origem ?? "")
  if (origem === "timesheet" || origem === "despesa") return origem
  const regra = String(s.regra_cobranca ?? "")
  if (regra) return regra
  if ("timesheet_horas" in s || "timesheet_descricao" in s) return "timesheet"
  return "regra"
}

/** 'YYYY-MM' ou 'YYYY-MM-DD' → 'YYYY-MM-01'; inválido → null. */
function normalizarCompetencia(value: unknown): string | null {
  const m = /^(\d{4})-(\d{2})/.exec(String(value ?? "").trim())
  if (!m) return null
  const mes = Number(m[2])
  if (mes < 1 || mes > 12) return null
  return `${m[1]}-${m[2]}-01`
}

function somarMeses(competencia: string, meses: number): string {
  const [ano, mes] = competencia.split("-").map(Number)
  const total = ano * 12 + (mes - 1) + meses
  const a = Math.floor(total / 12)
  const m = (total % 12) + 1
  return `${a}-${String(m).padStart(2, "0")}-01`
}

/**
 * Mês do serviço ('YYYY-MM-01') de uma nota com itens dessas naturezas.
 * Sem competência do kit válida, null (não dá para saber o mês).
 */
export function competenciaDoServicoDosItens(competenciaKit: string | null | undefined, naturezas: string[]): string | null {
  const base = normalizarCompetencia(competenciaKit)
  if (!base) return null
  return naturezas.some((n) => COBRADAS_NO_MES_SEGUINTE.has(String(n))) ? somarMeses(base, -1) : base
}

/** "Competência do serviço: setembro/2026". */
export function linhaCompetenciaDoServico(competenciaServico: string | null | undefined): string | null {
  const c = normalizarCompetencia(competenciaServico)
  if (!c) return null
  const [ano, mes] = c.split("-").map(Number)
  return `${ROTULO_COMPETENCIA_SERVICO}: ${MESES_PT[mes - 1]}/${ano}`
}

/** O texto já traz a linha (a prévia manda a descrição montada com ela). */
export function temLinhaCompetencia(texto: string): boolean {
  return texto.toLocaleLowerCase("pt-BR").includes(ROTULO_COMPETENCIA_SERVICO.toLocaleLowerCase("pt-BR"))
}

/**
 * Descrição editada na prévia: se a pessoa não deixou a linha (ou a prévia
 * antiga não a tinha), ela entra como 2ª linha — logo depois do nome do caso,
 * como na descrição automática. Se a linha já está lá, o texto fica como veio
 * (inclusive se a pessoa corrigiu o mês à mão).
 */
export function incluirCompetenciaNaDiscriminacao(texto: string, linha: string | null): string {
  if (!linha || temLinhaCompetencia(texto)) return texto
  const linhas = texto.split("\n")
  if (linhas.length === 0 || (linhas.length === 1 && !linhas[0].trim())) return linha
  return [linhas[0], linha, ...linhas.slice(1)].join("\n")
}

/**
 * Descrição automática: nomes do(s) caso(s), linha da competência do serviço
 * e o bloco fixo. Se passar do limite, quem encurta é a linha dos nomes dos
 * casos (com "…"), que é a única parte variável e sem valor fiscal — o bloco
 * fixo e a competência ficam inteiros.
 */
export function montarDiscriminacao(args: {
  casoNomes: string[]
  linhaCompetencia: string | null
  descricaoFixa: string
  limite?: number
}): string {
  const limite = args.limite ?? LIMITE_DISCRIMINACAO_NFSE
  const resto = [args.linhaCompetencia, args.descricaoFixa].filter(Boolean).join("\n")
  let casos = args.casoNomes.join("; ")
  if (!casos) return resto.length > limite ? resto.slice(0, limite) : resto
  const disponivel = limite - resto.length - 1 // -1 = quebra de linha
  if (casos.length > disponivel) {
    if (disponivel < 2) return resto.length > limite ? resto.slice(0, limite) : resto
    casos = casos.slice(0, disponivel - 1).trimEnd() + "…"
  }
  return [casos, resto].join("\n")
}
