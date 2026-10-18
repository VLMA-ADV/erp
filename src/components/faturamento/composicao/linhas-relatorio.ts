// Quais linhas de timesheet entram no relatório do kit (cliente, out/2026:
// "ocultar as linhas com 0h, as excluídas e as ignoradas").
//
// De onde vem cada coisa:
//  - Excluída / ignorada é decisão do ITEM de cobrança, não da linha:
//    excluir_billing_items grava finance.billing_items.status = 'cancelado'
//    (20260811100000_excluir_billing_items.sql) e ignorar_billing_items grava
//    status = 'ignorado' (20260715130000_revisao_rodada3.sql). "Excluir da
//    fila" marca operations.timesheets.excluido_faturamento antes de existir
//    item (20260812100000) — esse lançamento nem vira billing_item.
//    As linhas de snapshot.timesheet_itens_revisao não têm flag própria de
//    exclusão. get_composicao_fatura já só traz itens 'aprovado'/'faturado';
//    o filtro por status aqui é a garantia do lado do documento (ItemKit.status
//    é string livre e o relatório não pode depender de um WHERE distante).
//  - 0h = horas efetivas da linha. A RPC já entrega `horas` como
//    COALESCE(horas_revisadas, horas, horas_iniciais): a última etapa vale.
//
// Totais: o relatório soma as linhas que imprime (sempre foi assim), então
// total e linhas batem por construção. Para não sumir com dinheiro, linha de
// 0h que ainda carrega valor (só o fallback sem snapshot da RPC poderia
// produzir isso) NÃO é ocultada. Item excluído/ignorado não entra no valor
// do kit nem na NFS-e, então ocultá-lo mantém o relatório igual ao cobrado;
// mesmo assim o valor oculto é devolvido para quem chama poder avisar.

import type { ItemKit, LinhaTimesheet } from './types'

/** Status de billing_item que tiram o item da cobrança. */
const STATUS_FORA_DA_COBRANCA = new Set(['cancelado', 'ignorado', 'excluido'])

export type MotivoOculta = 'excluida' | 'ignorada' | 'zero_horas'

export interface LinhaDoRelatorio {
  item: ItemKit
  l: LinhaTimesheet
}

export interface LinhaOculta extends LinhaDoRelatorio {
  motivo: MotivoOculta
}

export interface LinhasDoRelatorio {
  visiveis: LinhaDoRelatorio[]
  ocultas: LinhaOculta[]
  /** Soma do valor das linhas ocultas (esperado 0 em 0h; excluída/ignorada não é cobrada). */
  valorOculto: number
}

const centavos = (v: unknown) => Math.round(Number(v || 0) * 100)

function motivoDoItem(status: string | null | undefined): MotivoOculta | null {
  const s = String(status ?? '').trim().toLowerCase()
  if (!STATUS_FORA_DA_COBRANCA.has(s)) return null
  return s === 'ignorado' ? 'ignorada' : 'excluida'
}

/** Linhas de timesheet do kit separadas em visíveis e ocultas, na ordem de entrada. */
export function linhasDoRelatorio(itens: ItemKit[]): LinhasDoRelatorio {
  const visiveis: LinhaDoRelatorio[] = []
  const ocultas: LinhaOculta[] = []
  for (const item of itens) {
    if (item.origem_tipo !== 'timesheet') continue
    const motivoItem = motivoDoItem(item.status)
    for (const l of item.linhas_timesheet ?? []) {
      // Horas em minutos inteiros: 0,004h não aparece no PDF como nada além de "0h".
      const zeroHoras = Math.round(Number(l.horas || 0) * 60) === 0
      const motivo: MotivoOculta | null = motivoItem ?? (zeroHoras && centavos(l.valor) === 0 ? 'zero_horas' : null)
      if (motivo) ocultas.push({ item, l, motivo })
      else visiveis.push({ item, l })
    }
  }
  const valorOculto = ocultas.reduce((acc, o) => acc + centavos(o.l.valor), 0) / 100
  return { visiveis, ocultas, valorOculto }
}
