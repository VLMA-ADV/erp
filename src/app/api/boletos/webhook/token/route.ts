import { NextRequest, NextResponse } from 'next/server'
import { credenciaisWebhookValidas, emitirTokenWebhook } from '@/lib/itau/webhook-auth'

export const runtime = 'nodejs'

/**
 * OAuth do NOSSO lado — é este endereço que vai no campo webhook_oauth_url do
 * cadastro de webhook no Itaú. O banco pega um token aqui e depois usa ele
 * para chamar /api/boletos/webhook.
 *
 * O Itaú não documenta se manda as credenciais no corpo ou em Basic; a coleção
 * só mostra os campos do cadastro. Aceitamos as duas formas — é barato e evita
 * uma ida e volta de suporte com o banco para descobrir qual é.
 */
/**
 * Diagnóstico de configuração — presença, nunca valor.
 *
 * O POST responde 'invalid_client' tanto para credencial errada quanto para
 * ambiente sem as variáveis, de propósito: quem está do outro lado não precisa
 * saber a diferença. O efeito colateral é que quem CONFIGUROU também não
 * consegue saber se acertou, e fica tentando adivinhar.
 *
 * Este GET responde só isso: as três variáveis existem? Não devolve, nem
 * confirma, nem compara nenhum valor — quem souber que o webhook está
 * configurado não ganha nada com a informação.
 */
export function GET() {
  return NextResponse.json({
    configurado: Boolean(
      process.env.ITAU_WEBHOOK_CLIENT_ID &&
      process.env.ITAU_WEBHOOK_CLIENT_SECRET &&
      process.env.ITAU_WEBHOOK_TOKEN_SECRET,
    ),
    variaveis: {
      ITAU_WEBHOOK_CLIENT_ID: Boolean(process.env.ITAU_WEBHOOK_CLIENT_ID),
      ITAU_WEBHOOK_CLIENT_SECRET: Boolean(process.env.ITAU_WEBHOOK_CLIENT_SECRET),
      ITAU_WEBHOOK_TOKEN_SECRET: Boolean(process.env.ITAU_WEBHOOK_TOKEN_SECRET),
    },
  })
}

export async function POST(req: NextRequest) {
  let clientId = ''
  let clientSecret = ''

  const basic = req.headers.get('authorization')
  if (basic?.toLowerCase().startsWith('basic ')) {
    try {
      const [id, ...resto] = Buffer.from(basic.slice(6).trim(), 'base64')
        .toString('utf8')
        .split(':')
      clientId = id ?? ''
      clientSecret = resto.join(':')
    } catch {
      // credencial ilegível cai na recusa padrão abaixo
    }
  }

  if (!clientId) {
    const tipo = req.headers.get('content-type') ?? ''
    if (tipo.includes('application/json')) {
      const b = (await req.json().catch(() => ({}))) as Record<string, string>
      clientId = b.client_id ?? ''
      clientSecret = b.client_secret ?? ''
    } else {
      const f = await req.formData().catch(() => null)
      clientId = String(f?.get('client_id') ?? '')
      clientSecret = String(f?.get('client_secret') ?? '')
    }
  }

  if (!credenciaisWebhookValidas(clientId, clientSecret)) {
    // Mesma resposta para credencial errada e para ambiente não configurado:
    // quem está do outro lado não precisa saber a diferença.
    return NextResponse.json({ error: 'invalid_client' }, { status: 401 })
  }

  const token = emitirTokenWebhook()
  if (!token) return NextResponse.json({ error: 'invalid_client' }, { status: 401 })

  return NextResponse.json(token, {
    // Token não entra em cache de CDN.
    headers: { 'Cache-Control': 'no-store' },
  })
}
