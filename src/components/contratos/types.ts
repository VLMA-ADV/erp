export interface ContratoListItem {
  id: string
  numero?: number
  cliente_id: string
  cliente_nome: string
  nome_contrato: string
  regime_fiscal: string | null
  status: 'rascunho' | 'ativo' | 'encerrado'
  created_at: string
  casos: CasoListItem[]
}

export interface CasoListItem {
  id: string
  numero?: number
  nome: string
  produto_id: string | null
  produto_nome?: string | null
  responsavel_id: string | null
  responsavel_nome?: string | null
  status?: 'rascunho' | 'ativo' | 'inativo'
  ativo: boolean
  created_at: string
}

export interface ContratoFormOptions {
  clientes: Array<{ id: string; nome: string }>
  servicos?: Array<{ id: string; nome: string }>
  produtos: Array<{ id: string; nome: string }>
  centros_custo: Array<{ id: string; nome: string }>
  cargos: Array<{ id: string; nome: string }>
  colaboradores: Array<{ id: string; nome: string; categoria?: string }>
  socios: Array<{ id: string; nome: string }>
  tabelas_preco?: Array<{
    id: string
    nome: string
    itens: Array<{
      cargo_id: string
      cargo_nome: string
      valor_hora: string
      valor_hora_excedente: string
    }>
  }>
}

export interface CasoPayload {
  id?: string
  status?: 'rascunho' | 'ativo' | 'inativo'
  anexos?: Array<{ id: string; nome: string; arquivo_nome: string; created_at: string }>
  nome: string
  servico_id?: string
  produto_id: string
  responsavel_id: string
  moeda: 'real' | 'euro' | 'dolar'
  tipo_cobranca_documento: 'invoice' | 'nf' | ''
  data_inicio_faturamento: string
  pagamento_dia_mes: string
  inicio_vigencia: string
  periodo_reajuste: string
  data_proximo_reajuste: string
  data_ultimo_reajuste: string
  indice_reajuste: string
  regra_cobranca:
    | 'hora'
    | 'hora_com_cap'
    | 'mensal'
    | 'mensalidade_processo'
    | 'projeto'
    | 'projeto_parcelado'
    | 'exito'
    | ''
  regra_cobranca_config: Record<string, any>
  centro_custo_rateio: Array<{ centro_custo_id: string; percentual?: number | null }>
  pagadores_servico: Array<{ cliente_id: string; percentual?: number | null }>
  despesas_config: Record<string, any>
  pagadores_despesa: Array<{ cliente_id: string; percentual?: number | null }>
  timesheet_config: Record<string, any>
  indicacao_config: Record<string, any>
}

export interface ContratoPayload {
  cliente_id: string
  nome_contrato: string
  regime_fiscal: string
  status?: 'rascunho' | 'ativo' | 'encerrado'
  casos: CasoPayload[]
}
