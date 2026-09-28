'use client'

import { useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FilePlus2, Paperclip } from 'lucide-react'
import { CommandSelect, type CommandSelectOption } from '@/components/ui/command-select'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import RateioSlider from '@/components/contratos/rateio-slider'
import { createClient } from '@/lib/supabase/client'
import { useColaboradoresSelecao } from '@/lib/hooks/use-colaboradores-selecao'

export interface PendingSolicitacaoAnexo {
  nome: string
  file: File
}

export interface CentroCustoRateioItem {
  centro_custo_id: string
  percentual: number
}

/** Valor especial do select de timesheet: sem pessoa fixa, segue o rateio. */
export const TIMESHEET_PROPORCIONAL = '__proporcional_centro_custo__'

/**
 * Bloco "Serviço" + solicitante (Filipe 28/09). Fica agrupado num objeto só
 * para as duas telas que montam a solicitação (lista e CRM) não repetirem
 * cinco estados cada.
 */
export interface SolicitacaoServicoValues {
  solicitanteColaboradorId: string
  servicoId: string
  produtoId: string
  centroCustoRateio: CentroCustoRateioItem[]
  /** '' | TIMESHEET_PROPORCIONAL | id de colaborador */
  timesheetSelecao: string
}

export const emptySolicitacaoServico: SolicitacaoServicoValues = {
  solicitanteColaboradorId: '',
  servicoId: '',
  produtoId: '',
  centroCustoRateio: [],
  timesheetSelecao: '',
}

/**
 * Converte o bloco para o payload da RPC create_solicitacao_contrato. Rateio e
 * timesheet saem no MESMO formato de contracts.casos (centro_custo_rateio /
 * timesheet_config), para o "Abrir contrato" copiar sem tradução.
 */
export function montarPayloadServico(values: SolicitacaoServicoValues) {
  const rateio = values.centroCustoRateio.filter((item) => item.centro_custo_id)
  const timesheet_config =
    values.timesheetSelecao === TIMESHEET_PROPORCIONAL
      ? { revisores_modo: 'auto_centro_custo' as const, revisores: [] }
      : values.timesheetSelecao
        ? { revisores_modo: 'manual' as const, revisores: [{ colaborador_id: values.timesheetSelecao, ordem: 1 }] }
        : null
  return {
    solicitante_colaborador_id: values.solicitanteColaboradorId || null,
    servico_id: values.servicoId || null,
    produto_id: values.produtoId || null,
    // centro_custo_id (coluna antiga) vai junto para quem só lê ele; a RPC
    // recalcula como o centro de maior percentual.
    centro_custo_id: rateio[0]?.centro_custo_id || null,
    centro_custo_rateio: rateio.length ? rateio : null,
    timesheet_config,
  }
}

interface Props {
  areasOptions: CommandSelectOption[]
  clientesOptions: CommandSelectOption[]
  creatingCliente: boolean
  descricaoSolicitacao: string
  disabled?: boolean
  nomeSolicitacao: string
  onAddFiles: (files: FileList | null) => void
  onCreateCliente: ((value: string) => void) | undefined
  onDescricaoSolicitacaoChange: (value: string) => void
  onNomeSolicitacaoChange: (value: string) => void
  onRemovePendingAnexo: (index: number) => void
  onSelectedClienteIdChange: (value: string) => void
  pendingAnexos: PendingSolicitacaoAnexo[]
  selectedClienteId: string
  servico: SolicitacaoServicoValues
  onServicoChange: (patch: Partial<SolicitacaoServicoValues>) => void
  // Campos pedidos pelo Filipe em 07/08. Responsável é LISTA (as pessoas já
  // estão cadastradas); os demais são texto livre porque são descrições ou
  // pessoas do cliente, que não temos no sistema.
  colaboradoresOptions: CommandSelectOption[]
  responsavelVlmaId: string
  onResponsavelVlmaChange: (value: string) => void
  regraCobrancaTexto: string
  onRegraCobrancaTextoChange: (value: string) => void
  indicacaoCrossSell: string
  onIndicacaoCrossSellChange: (value: string) => void
  contatosFinanceiro: string
  onContatosFinanceiroChange: (value: string) => void
}

interface OpcaoRpc {
  id: string
  nome: string
}

// Mesmas listas do cadastro de caso (get_servicos → operations.categorias_servico;
// get_servicos_produtos → contracts.produtos). Chama a RPC direto: as edges
// get-servicos / get-servicos-produtos são só um envelope dela.
async function buscarOpcoesRpc(fn: 'get_servicos' | 'get_servicos_produtos'): Promise<CommandSelectOption[]> {
  const supabase = createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.user?.id) return []
  const { data, error } = await supabase.rpc(fn, { p_user_id: session.user.id })
  if (error) throw new Error(error.message)
  const lista = Array.isArray(data) ? (data as OpcaoRpc[]) : []
  return lista.filter((item) => item?.id && item?.nome).map((item) => ({ value: item.id, label: item.nome }))
}

function BlocoTitulo({ children }: { children: string }) {
  return <p className="text-xs font-semibold uppercase tracking-wide text-ink-mute">{children}</p>
}

export default function SolicitacaoContratoFormFields({
  areasOptions,
  clientesOptions,
  creatingCliente,
  descricaoSolicitacao,
  disabled = false,
  nomeSolicitacao,
  onAddFiles,
  onCreateCliente,
  onDescricaoSolicitacaoChange,
  onNomeSolicitacaoChange,
  onRemovePendingAnexo,
  onSelectedClienteIdChange,
  pendingAnexos,
  selectedClienteId,
  servico,
  onServicoChange,
  colaboradoresOptions,
  responsavelVlmaId,
  onResponsavelVlmaChange,
  regraCobrancaTexto,
  onRegraCobrancaTextoChange,
  indicacaoCrossSell,
  onIndicacaoCrossSellChange,
  contatosFinanceiro,
  onContatosFinanceiroChange,
}: Props) {
  const { colaboradores: solicitantes, euColaboradorId } = useColaboradoresSelecao()
  const { data: servicoOptions = [] } = useQuery({
    queryKey: ['solicitacao-contrato', 'servicos'],
    queryFn: () => buscarOpcoesRpc('get_servicos'),
    staleTime: 5 * 60_000,
  })
  const { data: produtoOptions = [] } = useQuery({
    queryKey: ['solicitacao-contrato', 'produtos'],
    queryFn: () => buscarOpcoesRpc('get_servicos_produtos'),
    staleTime: 5 * 60_000,
  })

  const solicitanteOptions = useMemo(
    () => solicitantes.map((item) => ({ value: item.id, label: item.nome })),
    [solicitantes],
  )

  // Padrão do solicitante = quem está logado. Só preenche quando vazio, para
  // não sobrescrever uma escolha feita à mão.
  useEffect(() => {
    if (!euColaboradorId || servico.solicitanteColaboradorId) return
    onServicoChange({ solicitanteColaboradorId: euColaboradorId })
  }, [euColaboradorId, servico.solicitanteColaboradorId, onServicoChange])

  const timesheetOptions = useMemo<CommandSelectOption[]>(
    () => [
      { value: TIMESHEET_PROPORCIONAL, label: 'Proporcional ao centro de custo' },
      ...colaboradoresOptions,
    ],
    [colaboradoresOptions],
  )

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label>Nome do solicitante</Label>
        <CommandSelect
          value={servico.solicitanteColaboradorId}
          onValueChange={(value) => onServicoChange({ solicitanteColaboradorId: value })}
          options={solicitanteOptions}
          placeholder="Selecione quem está pedindo"
          searchPlaceholder="Buscar pessoa..."
          emptyText="Nenhuma pessoa encontrada"
          disabled={disabled}
        />
      </div>

      <div className="space-y-3 rounded-md border p-3">
        <BlocoTitulo>Dados do cliente</BlocoTitulo>

        <div className="space-y-2">
          <Label>Cliente</Label>
          <CommandSelect
            value={selectedClienteId}
            onValueChange={onSelectedClienteIdChange}
            options={clientesOptions}
            placeholder="Selecione o cliente (pode deixar em branco)"
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
            placeholder="Copie e cole o escopo da proposta"
            rows={4}
            disabled={disabled}
          />
        </div>
      </div>

      <div className="space-y-3 rounded-md border p-3">
        <BlocoTitulo>Serviço</BlocoTitulo>

        <RateioSlider
          title="Centro de custo (proporção em %)"
          options={areasOptions}
          items={servico.centroCustoRateio.map((item) => ({ id: item.centro_custo_id, percentual: item.percentual }))}
          onChange={(items) =>
            onServicoChange({
              centroCustoRateio: items.map((item) => ({ centro_custo_id: item.id, percentual: item.percentual })),
            })
          }
          disabled={disabled}
        />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Serviço</Label>
            <CommandSelect
              value={servico.servicoId}
              onValueChange={(value) => onServicoChange({ servicoId: value })}
              options={servicoOptions}
              placeholder="Selecione o serviço"
              searchPlaceholder="Buscar serviço..."
              emptyText="Nenhum serviço encontrado"
              disabled={disabled}
            />
          </div>

          <div className="space-y-2">
            <Label>Produto</Label>
            <CommandSelect
              value={servico.produtoId}
              onValueChange={(value) => onServicoChange({ produtoId: value })}
              options={produtoOptions}
              placeholder="Selecione o produto"
              searchPlaceholder="Buscar produto..."
              emptyText="Nenhum produto encontrado"
              disabled={disabled}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label>Timesheet</Label>
          <CommandSelect
            value={servico.timesheetSelecao}
            onValueChange={(value) => onServicoChange({ timesheetSelecao: value })}
            options={timesheetOptions}
            placeholder="Algum usuário ou proporcional ao centro de custo"
            searchPlaceholder="Buscar pessoa..."
            emptyText="Nenhuma opção encontrada"
            disabled={disabled}
          />
        </div>

        <div className="space-y-2">
          <Label>Responsável VLMA pelo caso</Label>
          <CommandSelect
            value={responsavelVlmaId}
            onValueChange={onResponsavelVlmaChange}
            options={colaboradoresOptions}
            placeholder="Selecione o responsável"
            searchPlaceholder="Buscar pessoa..."
            emptyText="Nenhuma pessoa encontrada"
            disabled={disabled}
          />
        </div>
      </div>

      <div className="space-y-3 rounded-md border p-3">
        <BlocoTitulo>Financeiro</BlocoTitulo>

        <div className="space-y-2">
          <Label>Regra de cobrança e esquema de pagamento</Label>
          <Textarea
            value={regraCobrancaTexto}
            onChange={(event) => onRegraCobrancaTextoChange(event.target.value)}
            placeholder="Como e quando o trabalho será pago"
            rows={3}
            disabled={disabled}
          />
        </div>

        <div className="space-y-2">
          <Label>Indicação ou cross sell</Label>
          <Input
            value={indicacaoCrossSell}
            onChange={(event) => onIndicacaoCrossSellChange(event.target.value)}
            placeholder="Quem indicou, ou de qual trabalho veio"
            disabled={disabled}
          />
        </div>

        <div className="space-y-2">
          <Label>Contatos do financeiro do cliente</Label>
          <Textarea
            value={contatosFinanceiro}
            onChange={(event) => onContatosFinanceiroChange(event.target.value)}
            placeholder="Nome e e-mail de quem recebe a cobrança"
            rows={2}
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
    </div>
  )
}
