'use client'

import { useRef } from 'react'
import { Paperclip, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatarTamanho, validarArquivos } from '@/lib/chamados/api'

/**
 * Seleção de anexos antes do envio (novo chamado e resposta). Valida tamanho
 * e quantidade no navegador — o bucket também limita a 25 MB, mas o aviso
 * daqui é em português e chega antes de gastar upload.
 */
export default function AnexosPendentes({
  arquivos,
  onChange,
  onErro,
  disabled = false,
  compacto = false,
}: {
  arquivos: File[]
  onChange: (arquivos: File[]) => void
  onErro: (mensagem: string) => void
  disabled?: boolean
  compacto?: boolean
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)

  const adicionar = (lista: FileList | null) => {
    if (!lista?.length) return
    const novos = Array.from(lista)
    const erro = validarArquivos(novos, arquivos.length)
    if (erro) {
      onErro(erro)
    } else {
      onChange([...arquivos, ...novos])
    }
    // Limpa o input para permitir escolher o mesmo arquivo de novo depois de remover.
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(event) => adicionar(event.target.files)}
          disabled={disabled}
          accept="image/*,video/*,.pdf,.txt,.csv,.xlsx,.docx"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
        >
          <Paperclip className="mr-1 h-4 w-4" />
          {compacto ? 'Anexar' : 'Anexar print ou vídeo'}
        </Button>
        {!compacto ? <span className="text-xs text-ink-mute">Até 25 MB por arquivo.</span> : null}
      </div>
      {arquivos.length ? (
        <ul className="space-y-1 rounded-md border border-hairline p-2">
          {arquivos.map((arquivo, idx) => (
            <li key={`${arquivo.name}_${arquivo.size}_${idx}`} className="flex items-center justify-between gap-2 text-sm">
              <div className="flex min-w-0 items-center gap-2">
                <Paperclip className="h-3.5 w-3.5 shrink-0 text-ink-mute" />
                <span className="truncate text-ink">{arquivo.name}</span>
                <span className="shrink-0 text-xs text-ink-mute">{formatarTamanho(arquivo.size)}</span>
              </div>
              <button
                type="button"
                className="rounded p-1 text-ink-mute hover:bg-canvas-soft hover:text-ink disabled:opacity-50"
                aria-label={`Remover ${arquivo.name}`}
                disabled={disabled}
                onClick={() => onChange(arquivos.filter((_, i) => i !== idx))}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
