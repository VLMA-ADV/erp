// Pendências do CONTRATO na competência (Filipe 16/10: "kit montado antes de
// todos os lançamentos do contrato serem tratados"; decisão da Jessika 28/10).
// O banco conta, por contrato, o que ainda não foi tratado no mês — na fila,
// em revisão, em aprovação (finance.pendencias_contratos) — e finalizar_kit
// recusa enquanto houver algo. Aqui só a apresentação: a bolinha verde/vermelha
// e o mesmo texto que o banco usa ao recusar, para o tooltip do botão.

import { cn } from '@/lib/utils/cn'

export interface PendenciasContrato {
  fila: number
  revisao: number
  aprovacao: number
  total: number
}

/** Mapa contrato_id → pendências (get_pendencias_contratos). Ausente = nada pendente. */
export type MapaPendencias = Record<string, PendenciasContrato>

export const SEM_PENDENCIAS: PendenciasContrato = { fila: 0, revisao: 0, aprovacao: 0, total: 0 }

export function somarPendencias(lista: Array<PendenciasContrato | null | undefined>): PendenciasContrato {
  return lista.reduce<PendenciasContrato>(
    (acc, p) =>
      p
        ? {
            fila: acc.fila + (p.fila || 0),
            revisao: acc.revisao + (p.revisao || 0),
            aprovacao: acc.aprovacao + (p.aprovacao || 0),
            total: acc.total + (p.total || 0),
          }
        : acc,
    { ...SEM_PENDENCIAS },
  )
}

/**
 * Soma por contrato DISTINTO: na Composição cada kit (caso) repete as
 * pendências do contrato dele, então o cabeçalho do cliente não pode somar
 * kit a kit. null quando nenhum kit trouxe o campo (não calculado).
 */
export function pendenciasDosContratos(
  kits: Array<{ contrato_id: string; pendencias?: PendenciasContrato | null }>,
): PendenciasContrato | null {
  const porContrato = new Map<string, PendenciasContrato>()
  for (const kit of kits) {
    if (kit.pendencias && !porContrato.has(kit.contrato_id)) porContrato.set(kit.contrato_id, kit.pendencias)
  }
  return porContrato.size ? somarPendencias(Array.from(porContrato.values())) : null
}

export function textoContagens(p: PendenciasContrato): string {
  return `fila: ${p.fila}, revisão: ${p.revisao}, aprovação: ${p.aprovacao}`
}

/**
 * Mesmo texto da recusa de finalizar_kit, para o tooltip do botão desabilitado.
 * null quando não há pendência (ou quando ela não foi calculada).
 */
export function motivoNaoFinalizar(p: PendenciasContrato | null | undefined, contratoLabel: string): string | null {
  if (!p || p.total <= 0) return null
  return `Não dá para finalizar: o ${contratoLabel.replace(/^Contrato/, 'contrato')} ainda tem ${p.total} lançamento(s) pendente(s) (${textoContagens(p)}).`
}

/**
 * Bolinha verde (nada pendente) / vermelha (há pendência) com as contagens no
 * tooltip. `pendencias` undefined/null = não calculado (RPC antiga, ou
 * Composição sem competência): não desenha nada, para não mentir verde.
 */
export function BolinhaPendencias({
  pendencias,
  escopo = 'contrato',
  className,
}: {
  pendencias: PendenciasContrato | null | undefined
  /** Só muda o texto do tooltip: "do contrato" ou "dos contratos deste cliente". */
  escopo?: 'contrato' | 'cliente'
  className?: string
}) {
  if (!pendencias) return null
  const pendente = pendencias.total > 0
  const de = escopo === 'cliente' ? 'nos contratos deste cliente' : 'no contrato'
  const titulo = pendente
    ? `${pendencias.total} lançamento(s) pendente(s) ${de} neste mês (${textoContagens(pendencias)}). O kit só pode ser finalizado quando tudo for tratado.`
    : `Nada pendente ${de} neste mês: tudo na fila, revisão e aprovação já foi tratado.`
  return (
    <span
      role="img"
      aria-label={titulo}
      title={titulo}
      className={cn(
        'inline-block h-2.5 w-2.5 shrink-0 rounded-full ring-2',
        pendente ? 'bg-red-500 ring-red-100' : 'bg-emerald-500 ring-emerald-100',
        className,
      )}
    />
  )
}
