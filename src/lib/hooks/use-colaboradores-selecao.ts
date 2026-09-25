'use client'

import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'

// Lista enxuta de colaboradores para selects de "Solicitante" (chamados e
// mensagens avulsas, pedido do Filipe 24/09: quem abre nem sempre é quem
// pediu). Vem da RPC listar_colaboradores_para_selecao, e não da edge
// list-colaboradores: a edge devolve a ficha inteira e não traz user_id, que
// é o que amarra o padrão "eu" ao usuário logado.

export interface ColaboradorSelecao {
  id: string
  nome: string
  user_id: string | null
}

export const QK_COLABORADORES_SELECAO = 'colaboradores-selecao'

async function buscarColaboradoresSelecao(): Promise<{
  euColaboradorId: string | null
  colaboradores: ColaboradorSelecao[]
}> {
  const supabase = createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.user?.id) return { euColaboradorId: null, colaboradores: [] }

  const { data, error } = await supabase.rpc('listar_colaboradores_para_selecao', {
    p_user_id: session.user.id,
  })
  if (error) throw new Error(error.message || 'Não foi possível carregar os colaboradores')

  const payload = (data ?? {}) as { eu_colaborador_id?: string | null; itens?: unknown }
  const itens = Array.isArray(payload.itens) ? (payload.itens as ColaboradorSelecao[]) : []
  return {
    euColaboradorId: payload.eu_colaborador_id ?? null,
    colaboradores: itens.filter((c) => c?.id && c?.nome),
  }
}

export function useColaboradoresSelecao(enabled = true) {
  const { data, isLoading } = useQuery({
    queryKey: [QK_COLABORADORES_SELECAO],
    queryFn: buscarColaboradoresSelecao,
    staleTime: 5 * 60_000,
    enabled,
  })
  return {
    colaboradores: data?.colaboradores ?? [],
    euColaboradorId: data?.euColaboradorId ?? null,
    carregando: isLoading,
  }
}
