// Lixeira do faturamento, por até 12 meses:
//  - etapa 1: lançamentos de hora excluídos da fila de faturar;
//  - etapa 2: timesheets e despesas apagados nas telas de lançamento (soft
//    delete — o registro fica no banco, marcado com apagado_em).
// Os dados vêm de get_lixeira_faturamento; aqui só o que a tela decide
// sozinha — filtro, avisos antes de restaurar, rótulos, montagem da chamada de
// restauração — para poder ser testado sem banco.

import { mesPorExtenso, normalizarCompetencia } from './competencia'

/** Permissão nominal de restaurar (a RPC confere de novo, por concessão direta). */
export const PERMISSAO_RESTAURAR_LIXEIRA = 'finance.faturamento.lixeira.restore'

/** Mesmo número da RPC: passou disso, o item só some da lixeira (nada é apagado). */
export const RETENCAO_LIXEIRA_MESES = 12

export type TipoItemLixeira = 'excluido_fila' | 'timesheet_apagado' | 'despesa_apagada'

export interface ItemLixeira {
  /** Itens da etapa 1 (antes do campo existir) são sempre 'excluido_fila'. */
  tipo?: TipoItemLixeira
  /** id do timesheet ou da despesa. */
  id?: string
  /** `${tipo}:${id}` — única na lista (use esta para seleção/chave do React). */
  chave?: string
  /** Preenchido para os dois tipos de timesheet. */
  timesheet_id: string | null
  despesa_id?: string | null
  /** Só despesa. */
  valor?: number | string | null
  categoria?: string | null
  cliente_id: string
  cliente_nome: string
  contrato_id: string
  contrato_numero: number | null
  contrato_numero_sequencial: number | null
  contrato_nome: string | null
  contrato_ativo: boolean
  caso_id: string
  caso_numero: number | null
  caso_nome: string | null
  caso_ativo: boolean
  profissional_nome: string
  data_lancamento: string
  horas: number | string
  descricao: string
  /** Quem/quando saiu da fila ou foi apagado (qualquer tipo). */
  excluido_por_id: string | null
  excluido_por_nome: string
  excluido_em: string
  /** Só exclusão da fila tem motivo. */
  motivo: string | null
  /** 'YYYY-MM-01' — competência em que estava quando foi excluído. */
  mes_original: string
  /** 'YYYY-MM-01' — para onde volta ao restaurar. */
  mes_destino: string
  expira_em: string
  dias_restantes: number
  kit_no_mes_original: boolean | null
  nfse_no_mes_original: string | null
}

export interface LixeiraPayload {
  pode_restaurar: boolean
  mes_destino: string
  itens: ItemLixeira[]
}

/** Tipo do item; o que veio sem tipo é da etapa 1 (excluído da fila). */
export function tipoDoItem(item: ItemLixeira): TipoItemLixeira {
  return item.tipo === 'timesheet_apagado' || item.tipo === 'despesa_apagada' ? item.tipo : 'excluido_fila'
}

/** id do registro (timesheet ou despesa). */
export function idDoItem(item: ItemLixeira): string {
  return item.id || item.despesa_id || item.timesheet_id || ''
}

/** Chave única na lista: o mesmo timesheet não aparece em dois tipos, mas a chave não depende disso. */
export function chaveDoItem(item: ItemLixeira): string {
  return item.chave || `${tipoDoItem(item)}:${idDoItem(item)}`
}

export const ROTULO_TIPO_LIXEIRA: Record<TipoItemLixeira, string> = {
  excluido_fila: 'Excluído da fila',
  timesheet_apagado: 'Timesheet apagado',
  despesa_apagada: 'Despesa apagada',
}

/** Aceita o jsonb da RPC e devolve sempre um payload utilizável. */
export function lerPayloadLixeira(data: unknown): LixeiraPayload {
  const obj = (data && typeof data === 'object' ? data : {}) as Partial<LixeiraPayload>
  return {
    pode_restaurar: obj.pode_restaurar === true,
    mes_destino: typeof obj.mes_destino === 'string' ? obj.mes_destino : '',
    itens: Array.isArray(obj.itens) ? obj.itens : [],
  }
}

export interface ParametrosRestauracao {
  p_excluidos: string[]
  p_timesheets: string[]
  p_despesas: string[]
}

/** Separa a seleção por tipo para restaurar_lixeira_faturamento (uma chamada, atômica). */
export function parametrosDeRestauracao(itens: ItemLixeira[]): ParametrosRestauracao {
  const p: ParametrosRestauracao = { p_excluidos: [], p_timesheets: [], p_despesas: [] }
  for (const item of itens) {
    const id = idDoItem(item)
    if (!id) continue
    const tipo = tipoDoItem(item)
    if (tipo === 'despesa_apagada') p.p_despesas.push(id)
    else if (tipo === 'timesheet_apagado') p.p_timesheets.push(id)
    else p.p_excluidos.push(id)
  }
  return p
}

function semAcento(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

export interface FiltroLixeira {
  busca?: string
  /** 'YYYY-MM' ou 'YYYY-MM-01'; vazio = todos. Compara com o mês original. */
  mes?: string
  /** vazio = todos os tipos. */
  tipo?: TipoItemLixeira | ''
}

/** Busca livre (cliente, contrato, caso, profissional, descrição, categoria, motivo, quem excluiu) + mês original + tipo. */
export function filtrarLixeira(itens: ItemLixeira[], filtro: FiltroLixeira): ItemLixeira[] {
  const termo = semAcento((filtro.busca || '').trim())
  const mes = filtro.mes ? normalizarCompetencia(filtro.mes) : null
  return itens.filter((item) => {
    if (filtro.tipo && tipoDoItem(item) !== filtro.tipo) return false
    if (mes && normalizarCompetencia(item.mes_original) !== mes) return false
    if (!termo) return true
    const campos = [
      item.cliente_nome,
      item.contrato_nome,
      item.contrato_numero_sequencial != null ? String(item.contrato_numero_sequencial) : '',
      item.caso_nome,
      item.caso_numero != null ? String(item.caso_numero) : '',
      item.profissional_nome,
      item.descricao,
      item.categoria,
      item.motivo,
      item.excluido_por_nome,
    ]
    return campos.some((c) => semAcento(String(c || '')).includes(termo))
  })
}

/** Meses originais presentes na lista, do mais recente para o mais antigo. */
export function mesesDaLixeira(itens: ItemLixeira[]): string[] {
  const set = new Set<string>()
  for (const item of itens) {
    const mes = normalizarCompetencia(item.mes_original)
    if (mes) set.add(mes)
  }
  return Array.from(set).sort().reverse()
}

/** "sai hoje", "1 dia", "30 dias". */
export function rotuloDiasRestantes(dias: number | null | undefined): string {
  const n = Math.max(0, Math.floor(Number(dias) || 0))
  if (n === 0) return 'sai hoje'
  return n === 1 ? '1 dia' : `${n} dias`
}

/**
 * Avisos a mostrar ANTES de confirmar a restauração. Um por caso+mês:
 *  - o mês original já tem kit (item aprovado/faturado do caso) ou NFS-e viva —
 *    o lançamento NÃO entra naquele kit/nota; vai para a fila do mês de destino;
 *  - contrato inativo ou caso inativo — a fila não mostra, então volta "invisível".
 * Timesheet apagado que também estava excluído da fila volta a ser só
 * "excluído" (continua fora da fila) — a RPC cuida disso; aqui não há aviso.
 */
export function avisosDeRestauracao(itens: ItemLixeira[]): string[] {
  const avisos: string[] = []
  const vistos = new Set<string>()
  for (const item of itens) {
    const caso = item.caso_numero != null ? `caso ${item.caso_numero}` : `caso ${item.caso_nome || '—'}`
    const chave = `${item.caso_id}|${item.mes_original}`
    if (!vistos.has(chave)) {
      vistos.add(chave)
      const mes = normalizarCompetencia(item.mes_original)
      const mesTxt = mes ? mesPorExtenso(mes) : item.mes_original
      if (item.nfse_no_mes_original) {
        avisos.push(
          `${caso}: ${mesTxt} já tem a NFS-e ${item.nfse_no_mes_original} emitida. O lançamento não entra nela — volta para a fila de ${rotuloMesLixeira(item.mes_destino)}.`,
        )
      } else if (item.kit_no_mes_original) {
        avisos.push(
          `${caso}: ${mesTxt} já tem kit montado. O lançamento não entra nele — volta para a fila de ${rotuloMesLixeira(item.mes_destino)}.`,
        )
      }
    }
    if (!item.contrato_ativo || !item.caso_ativo) {
      const chaveInativo = `inativo|${item.caso_id}`
      if (!vistos.has(chaveInativo)) {
        vistos.add(chaveInativo)
        avisos.push(
          `${caso}: ${!item.contrato_ativo ? 'o contrato está inativo' : 'o caso está inativo'} — o lançamento é restaurado, mas não aparece na fila enquanto não for reativado.`,
        )
      }
    }
  }
  return avisos
}

/** 'YYYY-MM-01' -> "outubro de 2026". */
export function rotuloMesLixeira(competencia: string): string {
  const mes = normalizarCompetencia(competencia)
  return mes ? mesPorExtenso(mes) : competencia
}
