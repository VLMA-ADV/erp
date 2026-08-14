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
