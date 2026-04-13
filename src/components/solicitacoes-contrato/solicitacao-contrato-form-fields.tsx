'use client'

import { FilePlus2, Paperclip } from 'lucide-react'
import { CommandSelect, type CommandSelectOption } from '@/components/ui/command-select'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { maskCNPJ } from '@/lib/utils/masks'

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
  hasNomeClienteNovo: boolean
  hasSelectedCliente: boolean
  nomeClienteNovo: string
  nomeSolicitacao: string
  onAddFiles: (files: FileList | null) => void
  onCentroCustoChange: (value: string) => void
  onCnpjClienteNovoChange: (value: string) => void
  onCreateCliente: ((value: string) => void) | undefined
  onDescricaoSolicitacaoChange: (value: string) => void
  onNomeClienteNovoChange: (value: string) => void
  onNomeSolicitacaoChange: (value: string) => void
  onRemovePendingAnexo: (index: number) => void
  onSelectedClienteIdChange: (value: string) => void
  pendingAnexos: PendingSolicitacaoAnexo[]
  selectedClienteId: string
  cnpjClienteNovo: string
}

export default function SolicitacaoContratoFormFields({
  areasOptions,
  centroCustoId,
  clientesOptions,
  creatingCliente,
  descricaoSolicitacao,
  disabled = false,
  hasNomeClienteNovo,
  hasSelectedCliente,
  nomeClienteNovo,
  nomeSolicitacao,
  onAddFiles,
  onCentroCustoChange,
  onCnpjClienteNovoChange,
  onCreateCliente,
  onDescricaoSolicitacaoChange,
  onNomeClienteNovoChange,
  onNomeSolicitacaoChange,
  onRemovePendingAnexo,
  onSelectedClienteIdChange,
  pendingAnexos,
  selectedClienteId,
  cnpjClienteNovo,
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
          disabled={creatingCliente || disabled || hasNomeClienteNovo}
        />
      </div>

      <div className="space-y-2">
        <Label>Nome do cliente novo</Label>
        <Input
          value={nomeClienteNovo}
          onChange={(event) => onNomeClienteNovoChange(event.target.value)}
          placeholder="Preencha apenas se o cliente ainda não existir"
          disabled={disabled || hasSelectedCliente}
        />
      </div>

      <div className="space-y-2">
        <Label>CNPJ do cliente novo</Label>
        <Input
          value={cnpjClienteNovo}
          onChange={(event) => onCnpjClienteNovoChange(maskCNPJ(event.target.value))}
          placeholder="00.000.000/0000-00"
          disabled={disabled || hasSelectedCliente}
        />
      </div>

      <div className="space-y-2">
        <Label>Nome do contrato</Label>
        <Input
          value={nomeSolicitacao}
          onChange={(event) => onNomeSolicitacaoChange(event.target.value)}
          placeholder="Nome da solicitação/contrato"
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
