// Discriminação da NFS-e na prévia: a mesma montagem da edge emit-nfse
// (supabase/functions/_shared/discriminacao-nfse.ts, que duplica isto porque
// Deno não importa de src/ — mudou aqui, muda lá).
//
// O que a prévia mostra é o que vai para a nota: o texto da prévia segue como
// descricao_servico na emissão de nota única. Por isso a linha "Competência do
// serviço" (cliente, out/2026) entra já aqui, e a edge só a acrescenta se o
// texto chegar sem ela.

import { competenciaDoServicoDosItens, type NaturezaCobranca } from './competencia-do-servico'
import { normalizarCompetencia } from './competencia'

/** Limite do campo xDescServ da NFS-e Nacional (TSDesc2000, até 2000 caracteres). */
export const LIMITE_DISCRIMINACAO_NFSE = 2000

export const ROTULO_COMPETENCIA_SERVICO = 'Competência do serviço'

const MESES_PT = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
]

/**
 * Natureza do item pelo snapshot do billing_item (o que
 * get_billing_items_aprovados_escopo devolve): snapshot.origem é o
 * origem_tipo; nas regras, snapshot.regra_cobranca diz qual.
 */
export function naturezaDoItem(snapshot: Record<string, unknown> | null | undefined): NaturezaCobranca {
  const s = snapshot ?? {}
  const origem = String(s.origem ?? '')
  if (origem === 'timesheet' || origem === 'despesa') return origem
  const regra = String(s.regra_cobranca ?? '')
  if (regra) return regra
  if ('timesheet_horas' in s || 'timesheet_descricao' in s) return 'timesheet'
  return 'regra'
}

/**
 * "Competência do serviço: setembro/2026" para a nota com estes itens, ou
 * null sem a competência do kit (a tela Fluxo não a manda à emissão).
 */
export function linhaCompetenciaDaNota(
  competenciaKit: string | null | undefined,
  snapshots: Array<Record<string, unknown> | null | undefined>,
): string | null {
  const kit = normalizarCompetencia(competenciaKit)
  if (!kit) return null
  const servico = competenciaDoServicoDosItens(kit, snapshots.map(naturezaDoItem))
  const [ano, mes] = servico.split('-').map(Number)
  return `${ROTULO_COMPETENCIA_SERVICO}: ${MESES_PT[mes - 1]}/${ano}`
}

/**
 * Descrição automática: nomes do(s) caso(s), competência do serviço e bloco
 * fixo. Passando do limite, encurta só a linha dos nomes dos casos.
 */
export function montarDiscriminacao(args: {
  casoNomes: string[]
  linhaCompetencia: string | null
  descricaoFixa: string
  limite?: number
}): string {
  const limite = args.limite ?? LIMITE_DISCRIMINACAO_NFSE
  const resto = [args.linhaCompetencia, args.descricaoFixa].filter(Boolean).join('\n')
  let casos = args.casoNomes.join('; ')
  if (!casos) return resto.length > limite ? resto.slice(0, limite) : resto
  const disponivel = limite - resto.length - 1
  if (casos.length > disponivel) {
    if (disponivel < 2) return resto.length > limite ? resto.slice(0, limite) : resto
    casos = casos.slice(0, disponivel - 1).trimEnd() + '…'
  }
  return [casos, resto].join('\n')
}
