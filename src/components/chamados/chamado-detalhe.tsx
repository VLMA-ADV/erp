'use client'

import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { format, formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { ArrowRight, Loader2, Paperclip, Send } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/toast'
import { usePermissionsContext } from '@/lib/contexts/permissions-context'
import {
  PERMISSAO_RESPONDER,
  QK_CHAMADO,
  QK_CHAMADOS,
  QK_CHAMADOS_PENDENTES,
  STATUS,
  abrirAnexo,
  classesStatus,
  formatarTamanho,
  obterChamado,
  responderChamado,
  rotuloCategoria,
  rotuloModulo,
  rotuloStatus,
  type ChamadoAnexo,
  type ChamadoStatus,
} from '@/lib/chamados/api'
import AnexosPendentes from './anexos-pendentes'
import AvatarAutor from './avatar-autor'

function dataCompleta(value: string | null | undefined) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return format(d, "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })
}

function dataRelativa(value: string | null | undefined) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return formatDistanceToNow(d, { addSuffix: true, locale: ptBR })
}

function ListaAnexos({ anexos, compacto = false }: { anexos: ChamadoAnexo[]; compacto?: boolean }) {
  const { error: toastError } = useToast()
  const [abrindo, setAbrindo] = useState<string | null>(null)
  if (!anexos.length) return null

  const abrir = async (anexo: ChamadoAnexo) => {
    setAbrindo(anexo.id)
    try {
      const ok = await abrirAnexo(anexo.storage_path)
      if (!ok) toastError('O navegador bloqueou a aba. Libere pop-ups para este site e tente de novo.')
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Não foi possível abrir o anexo')
    } finally {
      setAbrindo(null)
    }
  }

  return (
    <ul className={`flex flex-wrap gap-1.5 ${compacto ? 'mt-2' : 'mt-3'}`}>
      {anexos.map((anexo) => (
        <li key={anexo.id}>
          <button
            type="button"
            onClick={() => void abrir(anexo)}
            disabled={abrindo === anexo.id}
            className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-hairline bg-white px-2 py-1 text-xs text-ink hover:border-sky-200 hover:bg-sky-50 disabled:opacity-60"
            title={anexo.arquivo_nome}
          >
            {abrindo === anexo.id ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Paperclip className="h-3.5 w-3.5 text-ink-mute" />
            )}
            <span className="truncate">{anexo.arquivo_nome}</span>
            <span className="text-ink-mute">{formatarTamanho(anexo.tamanho_bytes)}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

/**
 * Detalhe do chamado (decisão 2.4a: o autor acompanha status e resposta).
 * Abrir marca como lido para quem abriu — é obter_chamado que faz isso — e por
 * isso a lista e o badge são invalidados assim que o detalhe carrega.
 *
 * Quem tem ops.chamados.responder vê o select de status ao lado de "Enviar";
 * para os demais a caixa só manda mensagem. O banco valida de verdade — aqui é
 * só para não mostrar um controle que não vai funcionar.
 */
export default function ChamadoDetalhe({
  chamadoId,
  onClose,
}: {
  chamadoId: string | null
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const { hasPermission } = usePermissionsContext()
  const { success, error: toastError } = useToast()

  const [mensagem, setMensagem] = useState('')
  const [novoStatus, setNovoStatus] = useState<ChamadoStatus | ''>('')
  const [arquivos, setArquivos] = useState<File[]>([])
  const [enviando, setEnviando] = useState(false)

  const { data, isLoading, isError, error, isSuccess } = useQuery({
    queryKey: [QK_CHAMADO, chamadoId],
    queryFn: () => obterChamado(chamadoId as string),
    enabled: Boolean(chamadoId),
    staleTime: 0,
  })

  // Reinicia a caixa de resposta ao trocar de chamado.
  useEffect(() => {
    setMensagem('')
    setNovoStatus('')
    setArquivos([])
  }, [chamadoId])

  // obter_chamado marcou como lido: reflete no badge e na lista.
  useEffect(() => {
    if (!isSuccess) return
    void queryClient.invalidateQueries({ queryKey: [QK_CHAMADOS] })
    void queryClient.invalidateQueries({ queryKey: [QK_CHAMADOS_PENDENTES] })
  }, [isSuccess, data?.updated_at, queryClient])

  const podeResponder = hasPermission(PERMISSAO_RESPONDER) || Boolean(data?.pode_responder)
  const statusAtual = data?.status ?? null
  const statusSelecionado = novoStatus || statusAtual || ''
  const mudaStatus = podeResponder && Boolean(novoStatus) && novoStatus !== statusAtual

  const enviar = async () => {
    if (!chamadoId) return
    const texto = mensagem.trim()
    if (!texto && !mudaStatus) {
      toastError('Escreva uma mensagem' + (podeResponder ? ' ou escolha um novo status.' : '.'))
      return
    }
    setEnviando(true)
    try {
      await responderChamado({
        chamadoId,
        mensagem: texto,
        status: mudaStatus ? (novoStatus as ChamadoStatus) : null,
        arquivos,
      })
      success(mudaStatus && !texto ? 'Status atualizado' : 'Resposta enviada')
      setMensagem('')
      setNovoStatus('')
      setArquivos([])
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [QK_CHAMADO, chamadoId] }),
        queryClient.invalidateQueries({ queryKey: [QK_CHAMADOS] }),
        queryClient.invalidateQueries({ queryKey: [QK_CHAMADOS_PENDENTES] }),
      ])
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Não foi possível enviar a resposta')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Dialog
      open={Boolean(chamadoId)}
      onOpenChange={(valor) => {
        if (enviando) return
        if (!valor) onClose()
      }}
    >
      <DialogContent className="flex max-h-[92vh] flex-col p-0 sm:max-w-3xl" data-testid="chamado-detalhe">
        {isLoading ? (
          <div className="flex items-center gap-2 p-8 text-sm text-ink-mute">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando chamado...
          </div>
        ) : isError || !data ? (
          <div className="p-6">
            <DialogHeader>
              <DialogTitle>Chamado</DialogTitle>
            </DialogHeader>
            <div className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {error instanceof Error ? error.message : 'Não foi possível abrir o chamado'}
            </div>
          </div>
        ) : (
          <>
            <div className="border-b border-hairline px-6 pb-4 pt-6">
              <DialogHeader>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-ink-mute">#{data.numero}</span>
                  <Badge className={classesStatus(data.status)}>{rotuloStatus(data.status)}</Badge>
                  <Badge>{rotuloCategoria(data.categoria)}</Badge>
                  <Badge>{rotuloModulo(data.modulo)}</Badge>
                  {data.urgencia === 'urgente' ? (
                    <Badge className="border-red-200 bg-red-50 text-red-700">Urgente</Badge>
                  ) : null}
                </div>
                <DialogTitle className="mt-1 text-lg font-semibold">{data.titulo}</DialogTitle>
              </DialogHeader>
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-mute">
                <span className="inline-flex items-center gap-1.5">
                  <AvatarAutor nome={data.autor?.nome} foto={data.autor?.foto_url} tamanho="sm" />
                  {data.autor?.nome ?? 'Autor desconhecido'}
                </span>
                <span title={dataCompleta(data.created_at)}>aberto {dataRelativa(data.created_at)}</span>
                {data.responsavel?.nome ? <span>responsável: {data.responsavel.nome}</span> : null}
                {data.resolvido_em ? (
                  <span title={dataCompleta(data.resolvido_em)}>encerrado {dataRelativa(data.resolvido_em)}</span>
                ) : null}
                {data.rota ? <span className="truncate">tela: {data.rota}</span> : null}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
              <section className="rounded-xl border border-hairline bg-canvas-soft/60 p-4">
                <p className="whitespace-pre-wrap text-sm text-ink">{data.descricao}</p>
                <ListaAnexos anexos={data.anexos} />
              </section>

              <section className="mt-5">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-mute">
                  {data.mensagens.length === 0
                    ? 'Ainda sem respostas'
                    : data.mensagens.length === 1
                      ? '1 mensagem'
                      : `${data.mensagens.length} mensagens`}
                </h3>
                <ol className="mt-3 space-y-3">
                  {data.mensagens.map((m) => {
                    const doAutor = Boolean(m.autor?.id && m.autor.id === data.autor?.id)
                    return (
                      <li key={m.id} className="flex items-start gap-2.5">
                        <AvatarAutor nome={m.autor?.nome} foto={m.autor?.foto_url} />
                        <div
                          className={`min-w-0 flex-1 rounded-xl border p-3 ${
                            doAutor ? 'border-hairline bg-white' : 'border-sky-100 bg-sky-50/50'
                          }`}
                        >
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="text-sm font-semibold text-ink">{m.autor?.nome ?? 'Autor desconhecido'}</span>
                            <span className="text-xs text-ink-mute" title={dataCompleta(m.created_at)}>
                              {dataRelativa(m.created_at)}
                            </span>
                            {m.status_novo ? (
                              <span className="inline-flex items-center gap-1 text-xs text-ink-mute">
                                <ArrowRight className="h-3 w-3" />
                                <Badge className={classesStatus(m.status_novo)}>{rotuloStatus(m.status_novo)}</Badge>
                              </span>
                            ) : null}
                          </div>
                          {m.mensagem ? (
                            <p className="mt-1 whitespace-pre-wrap text-sm text-ink-secondary">{m.mensagem}</p>
                          ) : null}
                          <ListaAnexos anexos={m.anexos} compacto />
                        </div>
                      </li>
                    )
                  })}
                </ol>
              </section>
            </div>

            <div className="border-t border-hairline bg-canvas-soft/40 px-6 py-4">
              <Label htmlFor="chamado-resposta" className="sr-only">Resposta</Label>
              <Textarea
                id="chamado-resposta"
                value={mensagem}
                onChange={(e) => setMensagem(e.target.value)}
                placeholder={podeResponder ? 'Responder ao chamado...' : 'Acrescentar informação ao chamado...'}
                rows={3}
                disabled={enviando}
              />
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <AnexosPendentes
                  arquivos={arquivos}
                  onChange={setArquivos}
                  onErro={(msg) => toastError(msg)}
                  disabled={enviando}
                  compacto
                />
                <div className="flex items-center gap-2">
                  {podeResponder ? (
                    <NativeSelect
                      aria-label="Status do chamado"
                      className="h-9 w-auto"
                      value={statusSelecionado}
                      onChange={(e) => setNovoStatus(e.target.value as ChamadoStatus)}
                      disabled={enviando}
                    >
                      {STATUS.map((s) => (
                        <option key={s.value} value={s.value}>{s.label}</option>
                      ))}
                    </NativeSelect>
                  ) : null}
                  <Button type="button" size="sm" className="h-9" onClick={() => void enviar()} disabled={enviando}>
                    {enviando ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Send className="mr-1 h-4 w-4" />}
                    {enviando ? 'Enviando...' : 'Enviar'}
                  </Button>
                </div>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
