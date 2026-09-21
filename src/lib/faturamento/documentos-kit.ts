// Documentos do kit da fatura: relatório de timesheet, nota de débito e ficha
// do boleto — gerados no navegador e REGISTRADOS no banco.
//
// Até setembro esses PDFs abriam numa aba e sumiam: ninguém sabia se o
// relatório daquele mês já tinha sido gerado, por quem, nem qual arquivo foi
// para o cliente. Filipe, 21/09 (D12-a): "passam a ser registrados
// automaticamente quando gerados (quem, quando, arquivo)". E o e-mail da
// fatura precisa achar o arquivo para anexar (D15-a) — por isso ele vai para o
// bucket privado 'faturamento-documentos', e finance.billing_notes guarda o
// PATH (não uma URL assinada, que expira). Quem lê assina na hora.

import { createClient } from '@/lib/supabase/client'

export const BUCKET_DOCUMENTOS = 'faturamento-documentos'

export type TipoDocumentoKit = 'relatorio_timesheet' | 'nota_debito' | 'boleto_itau'

export interface GerarERegistrarDocumentoInput {
  tipo: TipoDocumentoKit
  bytes: Uint8Array
  /** Nome amigável que o cliente vê no anexo (ex.: "Relatorio-timesheet-2026-09.pdf"). */
  nomeArquivo: string
  casoId: string | null
  contratoId: string
  /** 'YYYY-MM-01' */
  competencia: string
  /** billing_items que este documento cobre — fica em metadata.item_ids. */
  itemIds: string[]
  metadata?: Record<string, unknown>
}

export interface DocumentoKitRegistrado {
  /** id em finance.billing_notes */
  id: string
  /** Caminho no bucket — é o que fica em billing_notes.arquivo_url. */
  path: string
}

function mensagemDoErro(err: unknown, padrao: string): string {
  const m = err && typeof err === 'object' && 'message' in err ? String((err as { message: unknown }).message) : ''
  return m ? `${padrao}: ${m}` : padrao
}

async function sessaoETenant(supabase: ReturnType<typeof createClient>) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.user?.id) throw new Error('Sessão expirada. Entre de novo para continuar.')
  const { data: tenantRows, error } = await supabase.rpc('get_user_tenant', { p_user_id: session.user.id })
  const tenantId = Array.isArray(tenantRows) ? tenantRows[0]?.tenant_id : null
  if (error || !tenantId) throw new Error(mensagemDoErro(error, 'Não foi possível identificar o escritório do usuário'))
  return { userId: session.user.id as string, tenantId: String(tenantId) }
}

/**
 * Sobe o PDF para o bucket e registra em finance.billing_notes via
 * registrar_documento_kit (que cancela o documento anterior do mesmo
 * tipo/caso/competência — regerar substitui).
 *
 * Caminho: <tenant>/<YYYY-MM>/<caso ou contrato>/<tipo>-<timestamp>.pdf. O
 * timestamp evita colisão quando o relatório é gerado duas vezes no mês, e o
 * arquivo antigo continua no bucket para conferência (a nota antiga fica
 * 'cancelado' apontando para ele).
 */
export async function gerarERegistrarDocumento(input: GerarERegistrarDocumentoInput): Promise<DocumentoKitRegistrado> {
  const supabase = createClient()
  const { userId, tenantId } = await sessaoETenant(supabase)

  const competencia = /^\d{4}-\d{2}/.exec(input.competencia)?.[0]
  if (!competencia) throw new Error('Competência inválida para registrar o documento.')
  if (!input.bytes?.length) throw new Error('O PDF saiu vazio; nada foi registrado.')

  const pasta = input.casoId || input.contratoId
  const path = `${tenantId}/${competencia}/${pasta}/${input.tipo}-${Date.now()}.pdf`

  const { error: upErr } = await supabase.storage
    .from(BUCKET_DOCUMENTOS)
    .upload(path, input.bytes, { contentType: 'application/pdf', upsert: false })
  if (upErr) {
    throw new Error(mensagemDoErro(upErr, 'Não foi possível guardar o PDF no armazenamento'))
  }

  const { data, error } = await supabase.rpc('registrar_documento_kit', {
    p_user_id: userId,
    p_caso_id: input.casoId,
    p_contrato_id: input.contratoId,
    p_competencia: `${competencia}-01`,
    p_tipo: input.tipo,
    p_item_ids: input.itemIds,
    p_arquivo_nome: input.nomeArquivo,
    p_arquivo_url: path,
    p_metadata: input.metadata ?? {},
  })
  if (error) {
    // O arquivo subiu mas o registro falhou: remove para não deixar órfão.
    await supabase.storage.from(BUCKET_DOCUMENTOS).remove([path]).catch(() => null)
    throw new Error(mensagemDoErro(error, 'O PDF foi gerado mas não foi possível registrá-lo'))
  }

  const id = (data as { id?: string } | null)?.id
  if (!id) throw new Error('O registro do documento não devolveu um id.')
  return { id, path }
}

/**
 * URL assinada (60 s) para um documento do bucket. Serve para abrir numa aba
 * ou passar adiante; quem precisa só abrir usa abrirDocumentoDoKit.
 */
export async function urlAssinadaDoKit(path: string, segundos = 60): Promise<string> {
  const supabase = createClient()
  const { data, error } = await supabase.storage.from(BUCKET_DOCUMENTOS).createSignedUrl(path, segundos)
  if (error || !data?.signedUrl) {
    throw new Error(mensagemDoErro(error, 'Não foi possível abrir o documento'))
  }
  return data.signedUrl
}

/**
 * Abre o documento numa aba nova. A aba é aberta ANTES de assinar a URL para o
 * bloqueador de pop-up não engolir o clique (o navegador só libera window.open
 * síncrono ao clique). Devolve false se o navegador bloqueou.
 */
export async function abrirDocumentoDoKit(path: string): Promise<boolean> {
  // URL http(s) já pronta (NFS-e da Focus, por exemplo) abre direto.
  if (/^https?:\/\//i.test(path)) {
    return Boolean(window.open(path, '_blank', 'noopener'))
  }
  const aba = window.open('', '_blank')
  try {
    const url = await urlAssinadaDoKit(path)
    if (aba) {
      aba.location.href = url
      return true
    }
    return Boolean(window.open(url, '_blank', 'noopener'))
  } catch (err) {
    aba?.close()
    throw err
  }
}
