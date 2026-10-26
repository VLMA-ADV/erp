// Contratos das RPCs das metas do PDI por período + anexos no bucket privado
// pdi-metas-anexos + aba PDI da caixa de entrada. Os componentes só renderizam.

import { createClient } from '@/lib/supabase/client'
import type { AnexoMeta, EnvioPeriodo, MetaPeriodo, PainelDados, PeriodoCodigo } from './metas'
import { payloadMetas } from './metas'

export const BUCKET_METAS = 'pdi-metas-anexos'
export const TAMANHO_MAX_ANEXO_BYTES = 25 * 1024 * 1024
export const MAX_ANEXOS_POR_META = 10
export const QK_CAIXA_PDI = 'caixa-pdi'
export const QK_CAIXA_PDI_PENDENTES = 'caixa-pdi-pendentes'

export interface Faixa { codigo: string; rotulo: string; ordem: number }

export interface MinhasMetas {
  avaliacao_id: string | null
  tenant_id: string
  regua: Faixa[]
  periodos: EnvioPeriodo[]
  metas: MetaPeriodo[]
}

function erro(e: { message?: string } | null | undefined, padrao: string): Error {
  return new Error(e?.message || padrao)
}

export async function carregarMinhasMetas(ano: number): Promise<MinhasMetas> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('get_minhas_metas_pdi', { p_ano: ano })
  if (error) throw erro(error, 'Não foi possível carregar suas metas')
  return data as MinhasMetas
}

export async function salvarMetasPeriodo(
  avaliacaoId: string,
  periodo: PeriodoCodigo,
  metas: MetaPeriodo[],
  enviar: boolean,
): Promise<{ notificados: number }> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('salvar_minhas_metas_pdi', {
    p_avaliacao_id: avaliacaoId,
    p_periodo: periodo,
    p_metas: payloadMetas(metas),
    p_enviar: enviar,
  })
  if (error) throw erro(error, 'Não foi possível salvar as metas')
  const resp = (data ?? {}) as { notificados?: number; anexos_removidos?: string[] }
  // Metas removidas levam os anexos junto no banco; o arquivo sai do bucket aqui.
  const orfaos = Array.isArray(resp.anexos_removidos) ? resp.anexos_removidos : []
  if (orfaos.length) await supabase.storage.from(BUCKET_METAS).remove(orfaos).catch(() => null)
  return { notificados: Number(resp.notificados ?? 0) }
}

function nomeSeguro(nome: string): string {
  const base = nome.normalize('NFD').replace(/[̀-ͯ]/g, '')
  return base.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 120) || 'arquivo'
}

export function validarArquivosMeta(arquivos: File[], jaAnexados: number): string | null {
  if (jaAnexados + arquivos.length > MAX_ANEXOS_POR_META) return `Até ${MAX_ANEXOS_POR_META} anexos por meta.`
  const grande = arquivos.find((a) => a.size > TAMANHO_MAX_ANEXO_BYTES)
  if (grande) return `"${grande.name}" passa de 25 MB.`
  return null
}

/** Sobe os arquivos no bucket e registra cada um na meta (já salva). */
export async function anexarArquivos(
  tenantId: string,
  avaliacaoId: string,
  metaId: string,
  arquivos: File[],
): Promise<AnexoMeta[]> {
  const supabase = createClient()
  const out: AnexoMeta[] = []
  for (const arquivo of arquivos) {
    const path = `${tenantId}/${avaliacaoId}/${metaId}/${Date.now()}-${nomeSeguro(arquivo.name)}`
    const { error: upErr } = await supabase.storage
      .from(BUCKET_METAS)
      .upload(path, arquivo, { contentType: arquivo.type || 'application/octet-stream', upsert: false })
    if (upErr) throw erro(upErr, `Não foi possível enviar "${arquivo.name}"`)
    const { data, error } = await supabase.rpc('registrar_anexo_meta_pdi', {
      p_meta_id: metaId,
      p_arquivo_nome: arquivo.name,
      p_mime_type: arquivo.type || 'application/octet-stream',
      p_tamanho_bytes: arquivo.size,
      p_storage_path: path,
    })
    if (error) {
      await supabase.storage.from(BUCKET_METAS).remove([path]).catch(() => null)
      throw erro(error, `Não foi possível registrar "${arquivo.name}"`)
    }
    out.push(data as AnexoMeta)
  }
  return out
}

export async function removerAnexo(anexoId: string): Promise<void> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('remover_anexo_meta_pdi', { p_anexo_id: anexoId })
  if (error) throw erro(error, 'Não foi possível remover o anexo')
  const path = (data as { storage_path?: string } | null)?.storage_path
  if (path) await supabase.storage.from(BUCKET_METAS).remove([path]).catch(() => null)
}

/** Abre a aba antes de assinar a URL para o bloqueador de pop-up não engolir o clique. */
export async function abrirAnexoMeta(storagePath: string): Promise<void> {
  const aba = window.open('', '_blank')
  try {
    const supabase = createClient()
    const { data, error } = await supabase.storage.from(BUCKET_METAS).createSignedUrl(storagePath, 120)
    if (error || !data?.signedUrl) throw erro(error, 'Não foi possível abrir o anexo')
    if (aba) aba.location.href = data.signedUrl
    else window.open(data.signedUrl, '_blank', 'noopener')
  } catch (e) {
    aba?.close()
    throw e
  }
}

export async function reabrirPeriodo(avaliacaoId: string, periodo: PeriodoCodigo): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase.rpc('reabrir_periodo_metas_pdi', { p_avaliacao_id: avaliacaoId, p_periodo: periodo })
  if (error) throw erro(error, 'Não foi possível reabrir o período')
}

export interface PainelResposta extends PainelDados {
  ano: number
  escopo: 'proprio' | 'area' | 'todos'
  area_nome: string | null
  regua: Faixa[]
}

export async function carregarPainelMetas(ano: number): Promise<PainelResposta> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('get_painel_metas_pdi', { p_ano: ano })
  if (error) throw erro(error, 'Não foi possível carregar o painel')
  return data as PainelResposta
}

// --- caixa de entrada (aba PDI) ---------------------------------------------

export interface NotificacaoPdi {
  id: string
  tipo: 'autoavaliacao_enviada' | 'periodo_reaberto'
  periodo: PeriodoCodigo
  titulo: string
  created_at: string
  lido_at: string | null
  avaliacao_pdi_id: string
  link: string
}

export async function listarCaixaPdi(limite = 30): Promise<NotificacaoPdi[]> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('listar_caixa_pdi', { p_limite: limite })
  if (error) throw erro(error, 'Não foi possível carregar os avisos do PDI')
  return Array.isArray(data) ? (data as NotificacaoPdi[]) : []
}

export async function contarCaixaPdiPendentes(): Promise<number> {
  const supabase = createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return 0
  const { data, error } = await supabase.rpc('contar_caixa_pdi_pendentes')
  if (error) return 0
  return Number(data ?? 0)
}

export async function marcarCaixaPdiLida(opts: { ids?: string[]; avaliacaoId?: string }): Promise<void> {
  const supabase = createClient()
  await supabase.rpc('marcar_caixa_pdi_lida', {
    p_ids: opts.ids ?? null,
    p_avaliacao_id: opts.avaliacaoId ?? null,
  })
}
