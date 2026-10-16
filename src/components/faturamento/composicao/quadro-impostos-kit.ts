// Dados do quadro "Impostos" do relatório de timesheet a partir de um kit da
// Composição. O kit já traz pagadores (com o ajuste do kit aplicado), o grupo
// de impostos (id/nome) e as NFS-e vivas; o resto — regras do grupo,
// acumulado do mês de cada pagador e as retenções reais das notas — vem de
// get_quadro_impostos_kit numa chamada.

import { resolverGrupoImposto, type GrupoImpostoDb } from '@/lib/faturamento/impostos-nfse'
import { montarQuadroImpostos, type NotaEmitidaRetencoes } from '@/lib/faturamento/quadro-impostos'
import type { ImpostosRelatorio } from '@/lib/utils/timesheet-report-pdf'
import type { KitCaso } from './types'

export interface RespostaQuadroImpostos {
  mes?: string
  grupo: GrupoImpostoDb | null
  acumulados: Record<string, number | string>
  notas: NotaEmitidaRetencoes[]
}

/** NFS-e vivas do kit (a lista por pagador; na RPC antiga, a nota única). */
function notasDoKit(kit: KitCaso): Array<{ id: string; pagadorId: string | null }> {
  const nfses = kit.documentos.nfses
  if (nfses && nfses.length > 0) return nfses.map((n) => ({ id: n.id, pagadorId: n.pagador?.cliente_id ?? null }))
  const nfse = kit.documentos.nfse
  if (nfse && nfse.status === 'gerado' && !['erro', 'erro_autorizacao', 'cancelado'].includes(nfse.focus_status ?? '')) {
    return [{ id: nfse.id, pagadorId: null }]
  }
  return []
}

/** O que pedir à RPC: as notas do kit e os pagadores ainda sem nota. */
export function parametrosQuadroImpostos(kit: KitCaso) {
  const notas = notasDoKit(kit)
  const comNota = new Set(notas.map((n) => n.pagadorId).filter(Boolean))
  return {
    p_grupo_id: kit.grupo_imposto?.id ?? null,
    p_nota_ids: notas.map((n) => n.id),
    p_cliente_ids: (kit.pagadores ?? []).map((p) => p.cliente_id).filter((id) => id && !comNota.has(id)),
  }
}

/** Monta o quadro; null quando não há o que mostrar (kit sem serviço e sem nota). */
export function quadroImpostosDoKit(
  kit: KitCaso,
  resposta: RespostaQuadroImpostos,
  opts: { contratoClienteId: string | null; nomePadrao: string },
): ImpostosRelatorio | null {
  if (!(Number(kit.valor_servico) > 0) && resposta.notas.length === 0) return null
  const grupo = resposta.grupo ? resolverGrupoImposto(resposta.grupo, null) : null
  const acumuladoAtual = Object.fromEntries(Object.entries(resposta.acumulados ?? {}).map(([k, v]) => [k, Number(v ?? 0)]))
  const linhas = montarQuadroImpostos({
    pagadores: (kit.pagadores ?? []).map((p) => ({ cliente_id: p.cliente_id, nome: p.nome, percentual: Number(p.percentual || 0) })),
    valorServico: Number(kit.valor_servico || 0),
    grupo,
    acumuladoAtual,
    contratoClienteId: opts.contratoClienteId,
    notas: resposta.notas,
    nomePadrao: opts.nomePadrao,
  })
  return { linhas, grupoNome: resposta.grupo?.nome ?? kit.grupo_imposto?.nome ?? null }
}
