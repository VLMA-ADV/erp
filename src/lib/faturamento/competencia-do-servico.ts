// Competência que os DOCUMENTOS mostram (relatório de timesheet, nota de
// débito) — o mês em que o serviço foi prestado.
//
// A regra do ERP não muda: hora e despesa do mês M são cobradas no ciclo M+1
// (gatilhos de periodo_faturamento, 31/08 e 01/09), então o kit de competência
// outubro traz horas e despesas de SETEMBRO. O cliente pediu (out/2026) que o
// documento diga o mês do serviço, não o do ciclo de cobrança.
//
// Por que "competência do kit − 1" e não o mês das datas das linhas: as datas
// podem cair em meses diferentes (hora postergada, lançamento atrasado,
// despesa com periodo_faturamento informado à mão) e o documento precisa de
// UM mês. O kit − 1 é o mês que a regra do ERP associa ao ciclo e é sempre
// definido.

import { normalizarCompetencia, somarMeses } from './competencia'

/** Natureza do que o documento cobra. 'timesheet' e 'despesa' = origem_tipo dos billing_items. */
export type NaturezaCobranca = 'timesheet' | 'despesa' | 'regra' | (string & {})

/** Naturezas cobradas no mês seguinte ao do serviço. */
const COBRADAS_NO_MES_SEGUINTE = new Set<string>(['timesheet', 'despesa'])

/**
 * Mês do serviço ('YYYY-MM-01') para a competência do kit ('YYYY-MM-01').
 *
 * - Horas ('timesheet') e despesas ('despesa'): competência do kit − 1 mês.
 * - Mensalidade, projeto, salário mínimo, êxito e demais regras: o próprio
 *   mês da competência.
 *
 * DÚVIDA PENDENTE COM O CLIENTE (out/2026): se mensalidade/projeto também
 * devem mostrar o mês anterior. Para trocar, basta incluir a natureza em
 * COBRADAS_NO_MES_SEGUINTE (ou tratar o caso aqui) — o relatório de
 * timesheet e a nota de débito passam por esta função. A NFS-e não (é
 * montada na edge emit-nfse e segue com a competência do kit).
 */
export function competenciaDoServico(competenciaKit: string, natureza: NaturezaCobranca): string {
  const base = normalizarCompetencia(competenciaKit)
  if (!base) return competenciaKit
  return COBRADAS_NO_MES_SEGUINTE.has(String(natureza)) ? somarMeses(base, -1) : base
}

/**
 * Competência do serviço de um documento com itens de várias naturezas. Se
 * houver hora ou despesa, vale o mês do serviço delas (kit − 1); senão, o
 * próprio mês. Kit que mistura horas e mensalidade mostra o mês das horas.
 */
export function competenciaDoServicoDosItens(competenciaKit: string, naturezas: NaturezaCobranca[]): string {
  const cobradaDepois = naturezas.find((n) => COBRADAS_NO_MES_SEGUINTE.has(String(n)))
  return competenciaDoServico(competenciaKit, cobradaDepois ?? 'regra')
}
