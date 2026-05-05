'use client'

import { FilePlus2, Paperclip } from 'lucide-react'
import { CommandSelect, type CommandSelectOption } from '@/components/ui/command-select'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

export interface PendingMensagemAnexo {
  nome: string
  file: File
}

interface Props {
  casosOptions: CommandSelectOption[]
  clientesOptions: CommandSelectOption[]
  creatingCliente: boolean
  disabled?: boolean
  loadingCasos: boolean
  mensagem: string
  onAddFiles: (files: FileList | null) => void
  onCreateCliente: ((value: string) => void) | undefined
  onMensagemChange: (value: string) => void
  onRemovePendingAnexo: (index: number) => void
  onSelectedCasoIdChange: (value: string) => void
  onSelectedClienteIdChange: (value: string) => void
  pendingAnexos: PendingMensagemAnexo[]
  selectedCasoId: string
  selectedClienteId: string
}

export default function MensagemAvulsaFormFields({
  casosOptions,
  clientesOptions,
  creatingCliente,
  disabled = false,
  loadingCasos,
  mensagem,
  onAddFiles,
  onCreateCliente,
  onMensagemChange,
  onRemovePendingAnexo,
  onSelectedCasoIdChange,
  onSelectedClienteIdChange,
  pendingAnexos,
  selectedCasoId,
  selectedClienteId,
}: Props) {
  const casoDisabled = disabled || !selectedClienteId || loadingCasos

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Cliente</Label>
        <CommandSelect
          value={selectedClienteId}
          onValueChange={onSelectedClienteIdChange}
          options={clientesOptions}
          placeholder="Selecione o cliente"
          searchPlaceholder="Buscar cliente..."
          emptyText="Nenhum cliente encontrado"
          onCreateOption={onCreateCliente}
          createOptionLabel={creatingCliente ? 'Cadastrando' : 'Cadastrar cliente'}
          disabled={creatingCliente || disabled}
        />
      </div>

      <div className="space-y-2">
        <Label>Caso</Label>
        <CommandSelect
          value={selectedCasoId}
          onValueChange={onSelectedCasoIdChange}
          options={casosOptions}
          placeholder={
            !selectedClienteId
              ? 'Selecione o cliente primeiro'
              : loadingCasos
                ? 'Carregando casos...'
                : casosOptions.length === 0
                  ? 'Nenhum caso para este cliente'
                  : 'Selecione o caso'
          }
          searchPlaceholder="Buscar caso..."
          emptyText="Nenhum caso encontrado"
          disabled={casoDisabled}
        />
      </div>

      <div className="space-y-2">
        <Label>Mensagem</Label>
        <Textarea
          value={mensagem}
          onChange={(event) => onMensagemChange(event.target.value)}
          placeholder="Escreva a mensagem"
          rows={4}
          disabled={disabled}
        />
      </div>

      <div className="space-y-2">
        <Label>Arquivos</Label>
        <Input type="file" onChange={(event) => onAddFiles(event.target.files)} multiple disabled={disabled} />
        {pendingAnexos.length ? (
          <div className="space-y-2 rounded-md border p-3">
            {pendingAnexos.map((item, idx) => (
              <div key={`${item.file.name}_${idx}`} className="flex items-center justify-between gap-2 text-sm">
                <div className="flex min-w-0 items-center gap-2">
                  <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <p className="truncate font-medium">{item.nome}</p>
                    <p className="truncate text-xs text-muted-foreground">{item.file.name}</p>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onRemovePendingAnexo(idx)}
                  disabled={disabled}
                >
                  Remover
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-md border border-dashed px-3 py-4 text-sm text-muted-foreground">
            <FilePlus2 className="mb-2 h-4 w-4" />
            Nenhum arquivo selecionado.
          </div>
        )}
      </div>
    </div>
  )
}
