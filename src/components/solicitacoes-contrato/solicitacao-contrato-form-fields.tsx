'use client'

import { FilePlus2, Paperclip } from 'lucide-react'
import { CommandSelect, type CommandSelectOption } from '@/components/ui/command-select'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

export interface PendingSolicitacaoAnexo {
  nome: string
  file: File
}

interface Props {
  areasOptions: CommandSelectOption[]
  centroCustoId: string
  clientesOptions: CommandSelectOption[]
  creatingCliente: boolean
  descricaoSolicitacao: string
  disabled?: boolean
  nomeSolicitacao: string
  onAddFiles: (files: FileList | null) => void
  onCentroCustoChange: (value: string) => void
  onCreateCliente: ((value: string) => void) | undefined
  onDescricaoSolicitacaoChange: (value: string) => void
  onNomeSolicitacaoChange: (value: string) => void
  onRemovePendingAnexo: (index: number) => void
  onSelectedClienteIdChange: (value: string) => void
  pendingAnexos: PendingSolicitacaoAnexo[]
  selectedClienteId: string
}

export default function SolicitacaoContratoFormFields({
  areasOptions,
  centroCustoId,
  clientesOptions,
  creatingCliente,
  descricaoSolicitacao,
  disabled = false,
  nomeSolicitacao,
  onAddFiles,
  onCentroCustoChange,
  onCreateCliente,
  onDescricaoSolicitacaoChange,
  onNomeSolicitacaoChange,
  onRemovePendingAnexo,
  onSelectedClienteIdChange,
  pendingAnexos,
  selectedClienteId,
}: Props) {
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
        <Label>Nome do caso</Label>
        <Input
          value={nomeSolicitacao}
          onChange={(event) => onNomeSolicitacaoChange(event.target.value)}
          placeholder="Nome do caso"
          disabled={disabled}
        />
      </div>

      <div className="space-y-2">
        <Label>Descrição do contrato</Label>
        <Textarea
          value={descricaoSolicitacao}
          onChange={(event) => onDescricaoSolicitacaoChange(event.target.value)}
          placeholder="Descreva a solicitação para o financeiro concluir o cadastro"
          rows={4}
          disabled={disabled}
        />
      </div>

      <div className="space-y-2">
        <Label>Centro de custo</Label>
        <CommandSelect
          value={centroCustoId}
          onValueChange={onCentroCustoChange}
          options={areasOptions}
          placeholder="Selecione o centro de custo"
          searchPlaceholder="Buscar centro de custo..."
          emptyText="Nenhum centro de custo encontrado"
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
