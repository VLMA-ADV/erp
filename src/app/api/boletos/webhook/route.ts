import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { lerNotificacoes } from '@/lib/itau/boleto-payload'
import { tokenWebhookValido } from '@/lib/itau/webhook-auth'

export const runtime = 'nodejs'

/**
 * Recebe as notificações de baixa do Itaú e dá baixa no lançamento.
 *
 * É este endereço que vai no campo webhook_url do cadastro no banco. Quem
 * chama é o Itaú, não um usuário — por isso a autenticação é o token emitido
 * em /api/boletos/webhook/token e o acesso ao banco usa a service role.
 *
 * bol_aplicar_notificacao é idempotente de propósito: o Itaú reenvia a
 * notificação quando não recebe 200, e a mesma baixa chegando duas vezes não
 * pode virar dois recebimentos no fluxo de caixa.
 */
export async function POST(req: NextRequest) {
  if (!tokenWebhookValido(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const corpo = await req.json().catch(() => null)
  const notificacoes = lerNotificacoes(corpo)
  if (notificacoes.length === 0) {
    // Nada reconhecível. 200 porque reenviar não vai melhorar — e a checagem
    // de ambiente fica depois daqui de propósito: devolver 500 para um corpo
    // que seria ignorado põe o Itaú num ciclo de reenvio sem motivo.
    return NextResponse.json({ recebidos: 0 })
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceRoleKey) {
    // 500 e não 200: o Itaú precisa reenviar depois que o ambiente estiver
    // certo, senão a baixa se perde em silêncio.
    return NextResponse.json({ error: 'servidor sem configuração' }, { status: 500 })
  }

  const supabase = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const resultados = []
  for (const n of notificacoes) {
    const { data, error } = await supabase.rpc('bol_aplicar_notificacao', { p_notificacao: n })
    if (error) {
      // Uma notificação que falhou no banco tem de ser reenviada pelo Itaú.
      // Devolver 200 aqui perderia o pagamento.
      return NextResponse.json(
        { error: 'falha ao aplicar notificação', detalhe: error.message, aplicados: resultados },
        { status: 500 },
      )
    }
    resultados.push(data)
  }

  return NextResponse.json({ recebidos: notificacoes.length, resultados })
}
