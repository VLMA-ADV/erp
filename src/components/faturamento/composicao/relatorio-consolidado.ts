// Relatório de timesheet consolidado por contrato (Filipe, 16/10).
//
// Pattac: seis casos do mesmo contrato, seis relatórios para o cliente ler.
// Jamute: a mensalidade no caso 365 e as horas do projeto no 1828. Na
// Composição a pessoa escolhe quais kits do contrato (mesma competência)
// entram, e sai um PDF só: uma seção por caso com o total dele, o valor fixo
// no fim e o total geral (lib/utils/timesheet-report-pdf, `secoes`).
//
// Guardado por registrar_relatorio_consolidado
// (20261029110000_relatorio_consolidado_contrato.sql): um nº de documento, o
// do contrato, e um registro em cada kit. O primeiro kit da lista é a via
// principal — a única que vai no e-mail —, então ele é o primeiro kit cujo
// caso está configurado para enviar o relatório.

import { linhasDoRelatorio } from './linhas-relatorio'
import { ehItemDeMensalidade } from './valor-fixo-relatorio'
import type { KitCaso } from './types'

/** O kit tem o que relatar: linha de hora visível ou a mensalidade. */
export function kitEntraNoConsolidado(kit: KitCaso): boolean {
  if (!kit.caso_id) return false
  return linhasDoRelatorio(kit.itens).visiveis.length > 0 || kit.itens.some(ehItemDeMensalidade)
}

/**
 * Grupos (contrato + competência) com ≥ 2 kits que entram no consolidado,
 * kits na ordem do nº do caso. Só conta kits presentes na lista.
 */
export function gruposParaRelatorioConsolidado(kits: KitCaso[]): KitCaso[][] {
  const grupos = new Map<string, KitCaso[]>()
  for (const k of kits) {
    if (!kitEntraNoConsolidado(k)) continue
    const chave = `${k.contrato_id}|${k.competencia}`
    const lista = grupos.get(chave) ?? []
    lista.push(k)
    grupos.set(chave, lista)
  }
  return Array.from(grupos.values())
    .filter((g) => g.length >= 2)
    .map((g) => [...g].sort(ordemDosKits))
}

const ordemDosKits = (a: KitCaso, b: KitCaso) =>
  (a.caso_numero ?? Number.MAX_SAFE_INTEGER) - (b.caso_numero ?? Number.MAX_SAFE_INTEGER)
  || Number(a.kit_sequencia ?? 1) - Number(b.kit_sequencia ?? 1)

/**
 * Kits na ordem do registro: a via principal (a que vai no e-mail) primeiro
 * — o primeiro caso que envia relatório; nenhum enviando, o primeiro caso.
 */
export function ordemDoRegistro(kits: KitCaso[]): KitCaso[] {
  const ordenados = [...kits].sort(ordemDosKits)
  const principal = ordenados.find((k) => k.enviar_relatorio_timesheet) ?? ordenados[0]
  return principal ? [principal, ...ordenados.filter((k) => k !== principal)] : []
}
