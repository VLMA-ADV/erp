// Relatório de timesheet de caso de VALOR FIXO (cliente, out/2026).
//
// Valor fixo = SÓ mensalidade: regra 'mensal' e 'mensalidade_carteira' (esta
// confirmada pelo cliente em 20/10/2026: "nessa regra pode usar como valor
// fixo no relatório"). Pró-labore, projeto parcelado,
// mensalidade de processo e salário mínimo são outras categorias e o
// relatório deles fica como sempre.
//
// No caso mensal a hora vale R$ 0,00 (20260903230000_hora_em_caso_mensal_nao_cobra):
// é registro de trabalho, não cobrança. O relatório então:
//  - imprime as linhas sem valor (sem coluna Valor, sem "R$ 0,00");
//  - mostra a mensalidade do mês do serviço ("Mensalidade setembro/2026");
//  - soma o excedente quando a mensalidade tem teto de horas e o mês passou
//    dele (finance.aplicar_teto_horas cobra só a parte acima do teto) — essas
//    linhas saem com valor;
//  - total = mensalidade + excedente.
//
// De onde vem cada coisa, sem migration — só o que get_composicao_fatura já
// devolve:
//  - Regra do caso: kit.regra_cobranca (casos.regra_cobranca, ou a primeira
//    regra ativa de regras_financeiras).
//  - Item da mensalidade: origem_tipo 'regra_financeira' cuja `descricao` é o
//    código da regra. A RPC monta descricao como snapshot.regra_nome →
//    snapshot.descricao → snapshot.regra_cobranca, e o gerador de regras não
//    grava os dois primeiros (produção, out/2026: todos os itens de regra têm
//    descricao = regra_cobranca). Se um dia gravar regra_nome, este
//    reconhecimento precisa da regra no JSON do item.
//  - Valor de cada linha: o do ITEM de cobrança (o que vai na NFS-e), e não o
//    `valor` da linha, que a RPC calcula como horas × valor_hora do snapshot
//    da revisão. aplicar_teto_horas reprecifica o item e o snapshot.valor_hora,
//    mas não timesheet_itens_revisao: em produção (caso 314, kit de set/2026)
//    itens a R$ 0,00 têm linha a R$ 535,66/h. No caso fixo isso imprimiria
//    excedente que não existe.
//
// Kit de caso mensal SEM o item da mensalidade (decisão): o relatório NÃO
// inventa o valor a partir do cadastro — o total do PDF tem de bater com o
// que o kit cobra (NFS-e, quadro de impostos). Em vez disso o PDF diz, na
// linha da mensalidade, onde ela está, e a tela avisa antes de abrir:
//  - carteira: a mensalidade da carteira é lançada num caso só do contrato
//    (produção, out/2026: contrato da carteira com o item no caso 1261 e
//    horas nos casos 1866 e 1932). Se outro kit do mesmo contrato e
//    competência tem o item, a linha diz "cobrada no caso #N".
//  - senão (item ainda em revisão, ignorado ou em outra competência — caso
//    63, kit de set/2026: 20 lançamentos aprovados e a mensalidade em
//    revisão): "não incluída neste kit".

import { competenciaDoServico } from '@/lib/faturamento/competencia-do-servico'
import type { ValorFixoRelatorio } from '@/lib/utils/timesheet-report-pdf'
import type { LinhaDoRelatorio } from './linhas-relatorio'
import { labelCompetenciaCurta, type ItemKit, type KitCaso } from './types'

/** Regras de cobrança cujo relatório é de valor fixo. */
export const REGRAS_VALOR_FIXO = new Set(['mensal', 'mensalidade_carteira'])

const STATUS_FORA_DA_COBRANCA = new Set(['cancelado', 'ignorado', 'excluido'])

const norm = (v: unknown) => String(v ?? '').trim().toLowerCase()
const centavos = (v: unknown) => Math.round(Number(v || 0) * 100)

/** Item de cobrança da mensalidade (regra 'mensal' ou 'mensalidade_carteira'), vivo. */
export function ehItemDeMensalidade(item: ItemKit): boolean {
  return item.origem_tipo === 'regra_financeira'
    && REGRAS_VALOR_FIXO.has(norm(item.descricao))
    && !STATUS_FORA_DA_COBRANCA.has(norm(item.status))
}

export type ValorFixoDoKit =
  | { situacao: 'no_kit'; regra: string; rotulo: string; valor: number; itens: ItemKit[] }
  | { situacao: 'outro_caso'; regra: string; rotulo: string; casoNumero: number | null; casoNome: string }
  | { situacao: 'fora_do_kit'; regra: string; rotulo: string }

/** "Mensalidade setembro/2026" — mês do serviço (kit − 1). */
export function rotuloMensalidade(competenciaKit: string, regra: string): string {
  const mes = labelCompetenciaCurta(competenciaDoServico(competenciaKit, regra))
  return mes ? `Mensalidade ${mes}` : 'Mensalidade'
}

/**
 * Valor fixo do kit, ou null quando o caso não é de valor fixo (relatório de
 * sempre). `outrosKits` = os kits que a tela tem carregados, para achar a
 * mensalidade da carteira lançada em outro caso do mesmo contrato.
 */
export function valorFixoDoKit(kit: KitCaso, outrosKits: KitCaso[] = []): ValorFixoDoKit | null {
  const itens = kit.itens.filter(ehItemDeMensalidade)
  const regraCaso = norm(kit.regra_cobranca)
  const regra = REGRAS_VALOR_FIXO.has(regraCaso) ? regraCaso : itens.length > 0 ? norm(itens[0].descricao) : null
  if (!regra) return null
  const rotulo = rotuloMensalidade(kit.competencia, regra)
  if (itens.length > 0) {
    return { situacao: 'no_kit', regra, rotulo, valor: itens.reduce((s, i) => s + centavos(i.valor), 0) / 100, itens }
  }
  const irmao = outrosKits.find((k) =>
    k.chave !== kit.chave
    && k.contrato_id === kit.contrato_id
    && k.competencia === kit.competencia
    && k.itens.some((i) => ehItemDeMensalidade(i) && norm(i.descricao) === regra))
  if (irmao) return { situacao: 'outro_caso', regra, rotulo, casoNumero: irmao.caso_numero, casoNome: irmao.caso_nome }
  return { situacao: 'fora_do_kit', regra, rotulo }
}

/** O que o PDF imprime na linha da mensalidade. */
export function valorFixoParaPdf(fixo: ValorFixoDoKit): ValorFixoRelatorio {
  if (fixo.situacao === 'no_kit') return { rotulo: fixo.rotulo, valor: fixo.valor }
  if (fixo.situacao === 'outro_caso') {
    const caso = fixo.casoNumero ? `no caso #${fixo.casoNumero}` : `no caso ${fixo.casoNome}`
    return { rotulo: fixo.rotulo, valor: null, observacao: `mensalidade da carteira, cobrada ${caso}` }
  }
  return { rotulo: fixo.rotulo, valor: null, observacao: 'não incluída neste kit' }
}

/** Aviso para a tela quando a mensalidade não está no kit; null quando está. */
export function avisoValorFixo(fixo: ValorFixoDoKit): string | null {
  if (fixo.situacao === 'no_kit') return null
  if (fixo.situacao === 'outro_caso') {
    return `A mensalidade da carteira está no kit do caso ${fixo.casoNumero ? `#${fixo.casoNumero}` : fixo.casoNome}; ` +
      'este relatório lista as horas e diz onde ela é cobrada, sem somar o valor.'
  }
  return `${fixo.rotulo} não está neste kit (ainda em revisão, ignorada ou em outra competência). ` +
    'O relatório sai sem o valor fixo e diz isso na linha da mensalidade — confira antes de enviar.'
}

/**
 * Valor de cada linha do relatório de valor fixo: o valor do ITEM de cobrança
 * (ver cabeçalho), repartido pelas horas quando o item tem mais de uma linha
 * visível (a última absorve os centavos). Linha sem valor → null (o PDF não
 * imprime nada na coluna).
 */
export function valoresDasLinhasValorFixo(linhas: LinhaDoRelatorio[]): Array<number | null> {
  const porItem = new Map<string, number[]>()
  linhas.forEach(({ item }, idx) => {
    const lista = porItem.get(item.id) ?? []
    lista.push(idx)
    porItem.set(item.id, lista)
  })
  const valores: Array<number | null> = linhas.map(() => null)
  for (const idxs of Array.from(porItem.values())) {
    const item = linhas[idxs[0]].item
    const total = centavos(item.valor)
    if (total <= 0) continue
    const horas = idxs.map((i) => Math.max(0, Number(linhas[i].l.horas || 0)))
    const somaHoras = horas.reduce((s, h) => s + h, 0)
    let acumulado = 0
    idxs.forEach((i, k) => {
      const parte = k === idxs.length - 1
        ? total - acumulado
        : Math.round(somaHoras > 0 ? (total * horas[k]) / somaHoras : total / idxs.length)
      acumulado += parte
      valores[i] = parte > 0 ? parte / 100 : null
    })
  }
  return valores
}
