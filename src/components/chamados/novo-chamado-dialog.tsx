'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/toast'
import { useColaboradoresSelecao } from '@/lib/hooks/use-colaboradores-selecao'
import {
  CATEGORIAS,
  DESCRICAO_MAX,
  MODULOS,
  QK_CHAMADOS,
  QK_CHAMADOS_PENDENTES,
  TITULO_MAX,
  URGENCIAS,
  criarChamado,
  moduloPelaRota,
  type ChamadoCategoria,
  type ChamadoModulo,
  type ChamadoUrgencia,
} from '@/lib/chamados/api'
import AnexosPendentes from './anexos-pendentes'

/**
 * Formulário de abertura (decisão 2.2a de 09/09): categoria, módulo, título,
 * descrição, urgência e anexos. O módulo vem pré-preenchido pela rota em que a
 * pessoa estava (2.6c) — quem abre pelo botão flutuante do Timesheet quase
 * sempre está falando do Timesheet — mas pode trocar.
 *
 * "Solicitante" (Filipe 24/09): quem pediu, quando não é quem está abrindo —
 * a secretária abre em nome do sócio. Padrão = o próprio usuário logado.
 *
 * Os anexos sobem no bucket ANTES de criar_chamado; se algum falhar, o chamado
 * não é criado (ver criarChamado em lib/chamados/api.ts).
 */
export default function NovoChamadoDialog({
  open,
  onOpenChange,
  onCriado,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCriado?: (chamado: { id: string; numero: number }) => void
}) {
  const pathname = usePathname()
  const queryClient = useQueryClient()
  const { success, error: toastError } = useToast()

  const [categoria, setCategoria] = useState<ChamadoCategoria>('bug')
  const [modulo, setModulo] = useState<ChamadoModulo>('outro')
  const [titulo, setTitulo] = useState('')
  const [descricao, setDescricao] = useState('')
  const [urgencia, setUrgencia] = useState<ChamadoUrgencia>('normal')
  const [solicitanteId, setSolicitanteId] = useState('')
  const [arquivos, setArquivos] = useState<File[]>([])
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const { colaboradores, euColaboradorId, carregando: carregandoColaboradores } =
    useColaboradoresSelecao(open)

  // Reinicia o formulário a cada abertura, com o módulo da rota atual.
  useEffect(() => {
    if (!open) return
    setCategoria('bug')
    setModulo(moduloPelaRota(pathname))
    setTitulo('')
    setDescricao('')
    setUrgencia('normal')
    setSolicitanteId('')
    setArquivos([])
    setErro(null)
  }, [open, pathname])

  // Padrão do solicitante = eu. Chega depois da abertura (a lista é assíncrona),
  // então só preenche enquanto a pessoa ainda não escolheu ninguém.
  useEffect(() => {
    if (!open || !euColaboradorId) return
    setSolicitanteId((atual) => atual || euColaboradorId)
  }, [open, euColaboradorId])

  const fechar = (valor: boolean) => {
    if (enviando) return
    onOpenChange(valor)
  }

  const enviar = async () => {
    const tituloLimpo = titulo.trim()
    const descricaoLimpa = descricao.trim()
    if (!tituloLimpo) {
      setErro('Dê um título ao chamado.')
      return
    }
    if (tituloLimpo.length > TITULO_MAX) {
      setErro(`O título pode ter no máximo ${TITULO_MAX} caracteres.`)
      return
    }
    if (!descricaoLimpa) {
      setErro('Descreva o que aconteceu ou o que você sugere.')
      return
    }
    if (descricaoLimpa.length > DESCRICAO_MAX) {
      setErro(`A descrição pode ter no máximo ${DESCRICAO_MAX} caracteres.`)
      return
    }

    setErro(null)
    setEnviando(true)
    try {
      const criado = await criarChamado({
        categoria,
        modulo,
        titulo: tituloLimpo,
        descricao: descricaoLimpa,
        urgencia,
        rota: pathname || null,
        // Igual a mim = sem solicitante gravado (o autor já é o solicitante).
        solicitanteColaboradorId:
          solicitanteId && solicitanteId !== euColaboradorId ? solicitanteId : null,
        arquivos,
      })
      success(`Chamado #${criado.numero} aberto`)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [QK_CHAMADOS] }),
        queryClient.invalidateQueries({ queryKey: [QK_CHAMADOS_PENDENTES] }),
      ])
      onOpenChange(false)
      onCriado?.(criado)
    } catch (err) {
      const mensagem = err instanceof Error ? err.message : 'Não foi possível abrir o chamado'
      setErro(mensagem)
      toastError(mensagem)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={fechar}>
      <DialogContent className="sm:max-w-2xl" data-testid="novo-chamado-dialog">
        <DialogHeader>
          <DialogTitle>Novo chamado</DialogTitle>
          <DialogDescription>
            Conte o que deu errado, o que você sugere ou o que ficou em dúvida. Quem cuida do ERP
            responde por aqui mesmo.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="chamado-categoria">Tipo</Label>
              <NativeSelect
                id="chamado-categoria"
                value={categoria}
                onChange={(e) => setCategoria(e.target.value as ChamadoCategoria)}
                disabled={enviando}
              >
                {CATEGORIAS.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-2">
              <Label htmlFor="chamado-modulo">Módulo</Label>
              <NativeSelect
                id="chamado-modulo"
                value={modulo}
                onChange={(e) => setModulo(e.target.value as ChamadoModulo)}
                disabled={enviando}
              >
                {MODULOS.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-2">
              <Label htmlFor="chamado-urgencia">Urgência</Label>
              <NativeSelect
                id="chamado-urgencia"
                value={urgencia}
                onChange={(e) => setUrgencia(e.target.value as ChamadoUrgencia)}
                disabled={enviando}
              >
                {URGENCIAS.map((u) => (
                  <option key={u.value} value={u.value}>{u.label}</option>
                ))}
              </NativeSelect>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="chamado-solicitante">Solicitante</Label>
            <NativeSelect
              id="chamado-solicitante"
              value={solicitanteId}
              onChange={(e) => setSolicitanteId(e.target.value)}
              disabled={enviando || carregandoColaboradores}
              data-testid="chamado-solicitante"
            >
              {carregandoColaboradores ? <option value="">Carregando...</option> : null}
              {!carregandoColaboradores && !solicitanteId ? <option value="">Eu mesmo</option> : null}
              {colaboradores.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.id === euColaboradorId ? `${c.nome} (eu)` : c.nome}
                </option>
              ))}
            </NativeSelect>
            <p className="text-[11px] text-ink-mute">
              Quem pediu o chamado, se não for você (ex.: você abre em nome de um sócio).
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="chamado-titulo">Título</Label>
            <Input
              id="chamado-titulo"
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder="Ex.: Timesheet não salva lançamento de 15 min"
              maxLength={TITULO_MAX}
              disabled={enviando}
              autoFocus
            />
            <p className="text-right text-[11px] text-ink-mute">{titulo.length}/{TITULO_MAX}</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="chamado-descricao">Descrição</Label>
            <Textarea
              id="chamado-descricao"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder="O que você estava fazendo, o que esperava e o que aconteceu. Se der, anexe um print."
              rows={6}
              maxLength={DESCRICAO_MAX}
              disabled={enviando}
            />
            <p className="text-right text-[11px] text-ink-mute">{descricao.length}/{DESCRICAO_MAX}</p>
          </div>

          <div className="space-y-2">
            <Label>Anexos</Label>
            <AnexosPendentes
              arquivos={arquivos}
              onChange={setArquivos}
              onErro={(m) => toastError(m)}
              disabled={enviando}
            />
          </div>

          {erro ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {erro}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" disabled={enviando} onClick={() => fechar(false)}>
            Cancelar
          </Button>
          <Button type="button" onClick={() => void enviar()} disabled={enviando}>
            {enviando ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {arquivos.length ? 'Enviando anexos...' : 'Abrindo...'}
              </>
            ) : (
              'Abrir chamado'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
