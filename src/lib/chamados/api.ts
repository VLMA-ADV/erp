// Central de chamados (pedido Filipe 22/09/2026): colaborador abre chamado de
// suporte/sugestão do ERP; Filipe (e quem ele indicar) responde. Tudo fica
// dentro do VLMA — nada vai para a Flowcode nem por e-mail; o aviso é o badge
// da caixa de entrada que já existe.
//
// Este módulo concentra os contratos das RPCs (criar_chamado, listar_chamados,
// obter_chamado, responder_chamado, contar_chamados_pendentes), o upload dos
// anexos no bucket privado e os rótulos em português. Os componentes só
// renderizam.

import { createClient } from '@/lib/supabase/client'

export const BUCKET_CHAMADOS = 'chamados-anexos'
export const PERMISSAO_RESPONDER = 'ops.chamados.responder'

/** 25 MB por arquivo (decisão 2.7 de 09/09: print/vídeo, vários por chamado). */
export const TAMANHO_MAX_ANEXO_BYTES = 25 * 1024 * 1024
export const MAX_ANEXOS_POR_CHAMADO = 10
export const TITULO_MAX = 140
export const DESCRICAO_MAX = 5000

export type ChamadoCategoria = 'bug' | 'sugestao' | 'duvida'
export type ChamadoModulo =
  | 'timesheet'
  | 'despesas'
  | 'faturamento'
  | 'contratos'
  | 'crm'
  | 'pessoas'
  | 'relatorios'
  | 'outro'
export type ChamadoUrgencia = 'normal' | 'urgente'
export type ChamadoStatus = 'recebido' | 'em_analise' | 'feito' | 'nao_sera_feito'

export const CATEGORIAS: Array<{ value: ChamadoCategoria; label: string }> = [
  { value: 'bug', label: 'Erro' },
  { value: 'sugestao', label: 'Sugestão' },
  { value: 'duvida', label: 'Dúvida' },
]

export const MODULOS: Array<{ value: ChamadoModulo; label: string }> = [
  { value: 'timesheet', label: 'Timesheet' },
  { value: 'despesas', label: 'Despesas' },
  { value: 'faturamento', label: 'Faturamento' },
  { value: 'contratos', label: 'Contratos' },
  { value: 'crm', label: 'CRM' },
  { value: 'pessoas', label: 'Pessoas' },
  { value: 'relatorios', label: 'Relatórios' },
  { value: 'outro', label: 'Outro' },
]

export const URGENCIAS: Array<{ value: ChamadoUrgencia; label: string }> = [
  { value: 'normal', label: 'Normal' },
  { value: 'urgente', label: 'Urgente' },
]

export const STATUS: Array<{ value: ChamadoStatus; label: string }> = [
  { value: 'recebido', label: 'Recebido' },
  { value: 'em_analise', label: 'Em análise' },
  { value: 'feito', label: 'Feito' },
  { value: 'nao_sera_feito', label: 'Não será feito' },
]

export const STATUS_ABERTOS: ChamadoStatus[] = ['recebido', 'em_analise']

function rotulo<T extends string>(lista: Array<{ value: T; label: string }>, value: string | null | undefined) {
  return lista.find((item) => item.value === value)?.label ?? (value || '—')
}
export const rotuloCategoria = (v: string | null | undefined) => rotulo(CATEGORIAS, v)
export const rotuloModulo = (v: string | null | undefined) => rotulo(MODULOS, v)
export const rotuloUrgencia = (v: string | null | undefined) => rotulo(URGENCIAS, v)
export const rotuloStatus = (v: string | null | undefined) => rotulo(STATUS, v)

/** Classes de cor do badge de status — mesma paleta em lista, inbox e detalhe. */
export function classesStatus(status: string | null | undefined): string {
  switch (status) {
    case 'recebido':
      return 'border-sky-200 bg-sky-50 text-sky-700'
    case 'em_analise':
      return 'border-amber-200 bg-amber-50 text-amber-700'
    case 'feito':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700'
    case 'nao_sera_feito':
      return 'border-hairline bg-canvas-soft text-ink-mute'
    default:
      return 'border-hairline bg-canvas-soft text-ink-mute'
  }
}

/**
 * Módulo sugerido pela rota em que a pessoa estava ao clicar em "Novo chamado"
 * (decisão 2.6c: o botão flutuante "já preenche o módulo pela rota").
 */
export function moduloPelaRota(pathname: string | null | undefined): ChamadoModulo {
  const p = pathname || ''
  if (p.startsWith('/timesheet')) return 'timesheet'
  if (p.startsWith('/despesas')) return 'despesas'
  if (p.startsWith('/financeiro')) return 'faturamento'
  if (p.startsWith('/contratos') || p.startsWith('/solicitacoes-contrato')) return 'contratos'
  if (p.startsWith('/crm')) return 'crm'
  if (p.startsWith('/pessoas')) return 'pessoas'
  if (p.startsWith('/relatorios')) return 'relatorios'
  return 'outro'
}

// ---------------------------------------------------------------------------
// Tipos devolvidos pelas RPCs (contrato do spec)
// ---------------------------------------------------------------------------

export interface PessoaResumo {
  id: string | null
  nome: string | null
  foto_url?: string | null
}

export interface ChamadoAnexo {
  id: string
  chamado_id?: string
  mensagem_id?: string | null
  arquivo_nome: string
  mime_type: string | null
  tamanho_bytes: number | null
  storage_path: string
  created_by?: string | null
  created_at?: string
}

export interface ChamadoResumoItem {
  id: string
  numero: number
  categoria: ChamadoCategoria
  modulo: ChamadoModulo
  titulo: string
  urgencia: ChamadoUrgencia
  status: ChamadoStatus
  autor: PessoaResumo | null
  responsavel: PessoaResumo | null
  created_at: string
  updated_at: string
  total_mensagens: number
  total_anexos: number
  nao_lido: boolean
}

export interface ListaChamados {
  pode_responder: boolean
  resumo: {
    recebido: number
    em_analise: number
    feito: number
    nao_sera_feito: number
    urgentes_abertos: number
  }
  itens: ChamadoResumoItem[]
}

export interface ChamadoMensagem {
  id: string
  autor: PessoaResumo | null
  mensagem: string
  status_novo: ChamadoStatus | null
  created_at: string
  anexos: ChamadoAnexo[]
}

export interface ChamadoCompleto {
  id: string
  numero: number
  categoria: ChamadoCategoria
  modulo: ChamadoModulo
  titulo: string
  descricao: string
  urgencia: ChamadoUrgencia
  status: ChamadoStatus
  rota: string | null
  autor: PessoaResumo | null
  responsavel: PessoaResumo | null
  created_at: string
  updated_at: string
  resolvido_em: string | null
  anexos: ChamadoAnexo[]
  mensagens: ChamadoMensagem[]
  pode_responder: boolean
}

export interface FiltrosChamados {
  status?: ChamadoStatus | ''
  categoria?: ChamadoCategoria | ''
  modulo?: ChamadoModulo | ''
  somenteMeus?: boolean
  busca?: string
  limit?: number
}

export interface AnexoPayload {
  arquivo_nome: string
  mime_type: string
  tamanho_bytes: number
  storage_path: string
}

// ---------------------------------------------------------------------------
// Helpers de sessão / erro
// ---------------------------------------------------------------------------

function mensagemDoErro(err: unknown, padrao: string): string {
  const m = err && typeof err === 'object' && 'message' in err ? String((err as { message: unknown }).message) : ''
  return m ? `${padrao}: ${m}` : padrao
}

async function usuarioAtual(supabase: ReturnType<typeof createClient>): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.user?.id) throw new Error('Sessão expirada. Entre de novo para continuar.')
  return session.user.id
}

async function tenantAtual(supabase: ReturnType<typeof createClient>, userId: string): Promise<string> {
  const { data, error } = await supabase.rpc('get_user_tenant', { p_user_id: userId })
  const tenantId = Array.isArray(data) ? data[0]?.tenant_id : null
  if (error || !tenantId) throw new Error(mensagemDoErro(error, 'Não foi possível identificar o escritório do usuário'))
  return String(tenantId)
}

// ---------------------------------------------------------------------------
// RPCs
// ---------------------------------------------------------------------------

export async function listarChamados(filtros: FiltrosChamados = {}): Promise<ListaChamados> {
  const supabase = createClient()
  const userId = await usuarioAtual(supabase)
  const { data, error } = await supabase.rpc('listar_chamados', {
    p_user_id: userId,
    p_status: filtros.status || null,
    p_categoria: filtros.categoria || null,
    p_modulo: filtros.modulo || null,
    p_somente_meus: Boolean(filtros.somenteMeus),
    p_busca: filtros.busca?.trim() || null,
    p_limit: filtros.limit ?? 100,
  })
  if (error) throw new Error(mensagemDoErro(error, 'Não foi possível carregar os chamados'))
  const lista = (data ?? {}) as Partial<ListaChamados>
  return {
    pode_responder: Boolean(lista.pode_responder),
    resumo: {
      recebido: Number(lista.resumo?.recebido ?? 0),
      em_analise: Number(lista.resumo?.em_analise ?? 0),
      feito: Number(lista.resumo?.feito ?? 0),
      nao_sera_feito: Number(lista.resumo?.nao_sera_feito ?? 0),
      urgentes_abertos: Number(lista.resumo?.urgentes_abertos ?? 0),
    },
    itens: Array.isArray(lista.itens) ? lista.itens : [],
  }
}

/** Efeito colateral no banco: marca o chamado como lido para quem abriu. */
export async function obterChamado(chamadoId: string): Promise<ChamadoCompleto> {
  const supabase = createClient()
  const userId = await usuarioAtual(supabase)
  const { data, error } = await supabase.rpc('obter_chamado', {
    p_user_id: userId,
    p_chamado_id: chamadoId,
  })
  if (error) throw new Error(mensagemDoErro(error, 'Não foi possível abrir o chamado'))
  if (!data) throw new Error('Chamado não encontrado')
  const chamado = data as ChamadoCompleto
  return {
    ...chamado,
    anexos: Array.isArray(chamado.anexos) ? chamado.anexos : [],
    mensagens: Array.isArray(chamado.mensagens)
      ? chamado.mensagens.map((m) => ({ ...m, anexos: Array.isArray(m.anexos) ? m.anexos : [] }))
      : [],
  }
}

export async function contarChamadosPendentes(): Promise<number> {
  const supabase = createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.user?.id) return 0
  const { data, error } = await supabase.rpc('contar_chamados_pendentes', { p_user_id: session.user.id })
  if (error) return 0
  return Number(data ?? 0)
}

export interface NovoChamadoInput {
  categoria: ChamadoCategoria
  modulo: ChamadoModulo
  titulo: string
  descricao: string
  urgencia: ChamadoUrgencia
  rota: string | null
  arquivos: File[]
}

/**
 * Sobe os anexos no bucket e só então chama criar_chamado. Se qualquer upload
 * falhar, nada é criado (o chamado sem o print não serve para o Filipe
 * entender o problema) e os arquivos que já subiram são removidos.
 *
 * O chamado ainda não tem id quando os arquivos sobem, então a pasta do path
 * é um uuid gerado aqui: <tenant>/<uuid>/<timestamp>-<nome>. O que amarra
 * anexo a chamado é a linha em ops.chamado_anexos, não o caminho.
 */
export async function criarChamado(input: NovoChamadoInput): Promise<{ id: string; numero: number }> {
  const supabase = createClient()
  const userId = await usuarioAtual(supabase)
  const tenantId = await tenantAtual(supabase, userId)

  const pasta = novoUuid()
  const enviados = await subirAnexos(supabase, tenantId, pasta, input.arquivos)

  const { data, error } = await supabase.rpc('criar_chamado', {
    p_user_id: userId,
    p_payload: {
      categoria: input.categoria,
      modulo: input.modulo,
      titulo: input.titulo.trim(),
      descricao: input.descricao.trim(),
      urgencia: input.urgencia,
      rota: input.rota,
      anexos: enviados,
    },
  })
  if (error) {
    await removerAnexos(supabase, enviados)
    throw new Error(mensagemDoErro(error, 'Não foi possível abrir o chamado'))
  }
  const resultado = (data ?? {}) as { id?: string; numero?: number }
  if (!resultado.id) throw new Error('O chamado foi salvo mas não devolveu um número.')
  return { id: resultado.id, numero: Number(resultado.numero ?? 0) }
}

export interface RespostaChamadoInput {
  chamadoId: string
  mensagem: string
  status: ChamadoStatus | null
  arquivos: File[]
}

export async function responderChamado(input: RespostaChamadoInput): Promise<void> {
  const supabase = createClient()
  const userId = await usuarioAtual(supabase)
  const tenantId = await tenantAtual(supabase, userId)

  const enviados = await subirAnexos(supabase, tenantId, input.chamadoId, input.arquivos)

  const { error } = await supabase.rpc('responder_chamado', {
    p_user_id: userId,
    p_chamado_id: input.chamadoId,
    p_mensagem: input.mensagem.trim(),
    p_status: input.status,
    p_anexos: enviados,
  })
  if (error) {
    await removerAnexos(supabase, enviados)
    throw new Error(mensagemDoErro(error, 'Não foi possível enviar a resposta'))
  }
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

/** Confere tamanho e quantidade antes de subir. Devolve a mensagem de erro ou null. */
export function validarArquivos(arquivos: File[], jaExistentes = 0): string | null {
  if (arquivos.length + jaExistentes > MAX_ANEXOS_POR_CHAMADO) {
    return `No máximo ${MAX_ANEXOS_POR_CHAMADO} anexos por chamado.`
  }
  const grande = arquivos.find((f) => f.size > TAMANHO_MAX_ANEXO_BYTES)
  if (grande) {
    return `"${grande.name}" tem ${formatarTamanho(grande.size)}; o limite é 25 MB por arquivo.`
  }
  const vazio = arquivos.find((f) => f.size === 0)
  if (vazio) return `"${vazio.name}" está vazio.`
  return null
}

export function formatarTamanho(bytes: number | null | undefined): string {
  const n = Number(bytes ?? 0)
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function nomeSeguro(nome: string): string {
  // Storage do Supabase não aceita alguns caracteres na key; o nome original
  // fica em arquivo_nome, o path só precisa ser único e válido.
  const base = nome.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  return base.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 120) || 'arquivo'
}

function novoUuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`
}

async function subirAnexos(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
  pasta: string,
  arquivos: File[],
): Promise<AnexoPayload[]> {
  const erroValidacao = validarArquivos(arquivos)
  if (erroValidacao) throw new Error(erroValidacao)

  const enviados: AnexoPayload[] = []
  for (const arquivo of arquivos) {
    const path = `${tenantId}/${pasta}/${Date.now()}-${nomeSeguro(arquivo.name)}`
    const { error } = await supabase.storage
      .from(BUCKET_CHAMADOS)
      .upload(path, arquivo, { contentType: arquivo.type || 'application/octet-stream', upsert: false })
    if (error) {
      await removerAnexos(supabase, enviados)
      throw new Error(mensagemDoErro(error, `Não foi possível enviar o anexo "${arquivo.name}"`))
    }
    enviados.push({
      arquivo_nome: arquivo.name,
      mime_type: arquivo.type || 'application/octet-stream',
      tamanho_bytes: arquivo.size,
      storage_path: path,
    })
  }
  return enviados
}

async function removerAnexos(supabase: ReturnType<typeof createClient>, enviados: AnexoPayload[]) {
  if (!enviados.length) return
  await supabase.storage
    .from(BUCKET_CHAMADOS)
    .remove(enviados.map((a) => a.storage_path))
    .catch(() => null)
}

/**
 * Abre o anexo numa aba nova. A aba é aberta ANTES de assinar a URL para o
 * bloqueador de pop-up não engolir o clique (mesmo truque de documentos-kit).
 */
export async function abrirAnexo(storagePath: string): Promise<boolean> {
  const aba = window.open('', '_blank')
  try {
    const supabase = createClient()
    const { data, error } = await supabase.storage.from(BUCKET_CHAMADOS).createSignedUrl(storagePath, 120)
    if (error || !data?.signedUrl) {
      throw new Error(mensagemDoErro(error, 'Não foi possível abrir o anexo'))
    }
    if (aba) {
      aba.location.href = data.signedUrl
      return true
    }
    return Boolean(window.open(data.signedUrl, '_blank', 'noopener'))
  } catch (err) {
    aba?.close()
    throw err
  }
}

/** Chaves do react-query usadas pela página, pelo inbox e pelo detalhe. */
export const QK_CHAMADOS = 'chamados'
export const QK_CHAMADO = 'chamado'
export const QK_CHAMADOS_PENDENTES = 'chamados-pendentes'
