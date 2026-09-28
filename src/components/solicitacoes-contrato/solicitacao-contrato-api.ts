import { createClient } from '@/lib/supabase/client'

// Leitura das solicitações de contrato. Vai direto na RPC
// get_solicitacoes_contrato (a mesma que o contrato-form usa no "Abrir
// contrato"): a edge get-solicitacoes-contrato era só um envelope dela, e ir
// direto garante que os campos novos (blocos de 28/09) chegam sem depender de
// redeploy de edge.

export interface SolicitacaoContratoAnexo {
  id: string
  nome: string
  arquivo_nome: string
  mime_type: string | null
  tamanho_bytes: number | null
  created_at: string
}

export interface SolicitacaoRateioItem {
  centro_custo_id: string
  centro_custo_nome: string | null
  percentual: number
}

export interface SolicitacaoContratoItem {
  id: string
  descricao: string
  nome?: string | null
  status: 'aberta' | 'concluida' | 'cancelada'
  cliente_id: string | null
  cliente_nome: string | null
  contrato_id: string | null
  contrato_numero: number | null
  contrato_numero_sequencial: number | null
  contrato_nome: string | null
  solicitante_user_id: string
  solicitante_colaborador_id: string | null
  solicitante_nome: string | null
  centro_custo_id?: string | null
  centro_custo_nome?: string | null
  centro_custo_rateio?: SolicitacaoRateioItem[]
  servico_id?: string | null
  servico_nome?: string | null
  produto_id?: string | null
  produto_nome?: string | null
  timesheet_config?: Record<string, unknown> | null
  timesheet_descricao?: string | null
  responsavel_vlma_id?: string | null
  responsavel_vlma_nome?: string | null
  regra_cobranca_texto?: string | null
  indicacao_cross_sell?: string | null
  contatos_financeiro?: string | null
  concluida_em: string | null
  created_at: string
  lido_at?: string | null
  anexos: SolicitacaoContratoAnexo[]
}

export async function buscarSolicitacoesContrato(): Promise<SolicitacaoContratoItem[]> {
  const supabase = createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.user?.id) return []

  const { data, error } = await supabase.rpc('get_solicitacoes_contrato', {
    p_user_id: session.user.id,
    p_only_unread: false,
  })
  if (error) throw new Error(error.message || 'Erro ao carregar solicitações')
  return Array.isArray(data) ? (data as SolicitacaoContratoItem[]) : []
}

export const CLIENTE_A_DEFINIR = 'Cliente a definir'

export function formatRateio(items?: SolicitacaoRateioItem[] | null) {
  if (!items?.length) return ''
  return items.map((item) => `${item.centro_custo_nome || '-'} (${item.percentual ?? 0}%)`).join(' | ')
}
