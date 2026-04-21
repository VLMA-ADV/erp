export interface ContratoListItem {
  id: string
  numero?: number
  numero_sequencial?: number | null
  cliente_id: string
  cliente_nome: string
  nome_contrato: string
  forma_entrada?: 'organico' | 'prospeccao' | null
  responsavel_prospeccao_id?: string | null
  responsavel_prospeccao_nome?: string | null
  canal_prospeccao?: string | null
  grupo_imposto_id?: string | null
  grupo_imposto_nome?: string | null
  status: 'rascunho' | 'solicitacao' | 'validacao' | 'ativo' | 'encerrado' | 'em_analise'
  created_at: string
  casos: CasoListItem[]
}

export interface CasoListItem {
  id: string
  numero?: number
  nome: string
  servico_id?: string | null
  servico_nome?: string | null
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
  prestadores?: Array<{ id: string; nome: string }>
  parceiros?: Array<{ id: string; nome: string }>
  grupos_impostos?: Array<{ id: string; nome: string; descricao?: string | null }>
  servicos?: Array<{ id: string; nome: string }>
  produtos: Array<{ id: string; nome: string }>
  centros_custo: Array<{ id: string; nome: string }>
  cargos: Array<{ id: string; nome: string }>
  colaboradores: Array<{ id: string; nome: string; categoria?: string; ativo?: boolean }>
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
  regras_financeiras?: Array<Record<string, any>>
  nome: string
  observacao?: string
  polo?: 'ativo' | 'passivo' | null
  servico_id?: string
  produto_id: string
  responsavel_id: string
  moeda: 'real' | 'euro' | 'dolar'
  tipo_cobranca_documento: 'invoice' | 'nf' | ''
  data_inicio_faturamento: string
  dia_inicio_faturamento?: number | ''
  pagamento_dia_mes: string
  inicio_vigencia: string
  possui_reajuste?: boolean
  periodo_reajuste: string
  data_proximo_reajuste: string
  data_ultimo_reajuste: string
  indice_reajuste: string
  possui_cap_horas?: boolean
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
  nome_contrato?: string
  numero_sequencial?: number | null
  forma_entrada?: 'organico' | 'prospeccao' | ''
  responsavel_prospeccao_id?: string | null
  canal_prospeccao?: string | null
  grupo_imposto_id?: string | null
  status?: 'rascunho' | 'solicitacao' | 'validacao' | 'ativo' | 'encerrado' | 'em_analise'
  casos: CasoPayload[]
}
