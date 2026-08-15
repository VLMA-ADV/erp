import { Buffer } from 'node:buffer'
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import process from 'node:process'

/**
 * Autenticação do webhook de boletos.
 *
 * O sentido aqui é INVERTIDO em relação ao resto da integração: quem chama
 * somos nós na emissão, mas na notificação de pagamento quem chama é o Itaú.
 * O banco exige que o integrador exponha o próprio OAuth — no cadastro do
 * webhook informamos webhook_oauth_url, webhook_client_id e
 * webhook_client_secret, e o Itaú primeiro pega um token nesse endereço e
 * depois chama a URL de notificação com ele.
 *
 * Ou seja: essas credenciais são NOSSAS, criadas por nós para o banco usar.
 * Não são as credenciais do Itaú.
 *
 * O token é assinado por HMAC e carrega a validade dentro dele. Não há tabela
 * de sessões: o webhook é chamado pelo banco a qualquer hora, e uma tabela de
 * tokens seria mais uma coisa para expirar, limpar e dar problema — o segredo
 * do servidor já basta para validar.
 */

const VALIDADE_SEGUNDOS = 3600

function segredo(): string | null {
  return process.env.ITAU_WEBHOOK_TOKEN_SECRET || null
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function assinar(payload: string, chave: string): string {
  return b64url(createHmac('sha256', chave).update(payload).digest())
}

/** Comparação em tempo constante; evita distinguir segredo errado por timing. */
export function comparaSegura(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}

/**
 * Confere as credenciais que o Itaú apresenta para pegar um token.
 * Devolve false se não estiverem configuradas — melhor recusar do que aceitar
 * qualquer um enquanto o ambiente não estiver completo.
 */
export function credenciaisWebhookValidas(clientId: string, clientSecret: string): boolean {
  const id = process.env.ITAU_WEBHOOK_CLIENT_ID
  const secret = process.env.ITAU_WEBHOOK_CLIENT_SECRET
  if (!id || !secret) return false
  return comparaSegura(clientId ?? '', id) && comparaSegura(clientSecret ?? '', secret)
}

export interface TokenWebhook {
  access_token: string
  token_type: 'Bearer'
  expires_in: number
}

export function emitirTokenWebhook(agoraMs = Date.now()): TokenWebhook | null {
  const chave = segredo()
  if (!chave) return null
  const exp = Math.floor(agoraMs / 1000) + VALIDADE_SEGUNDOS
  const corpo = b64url(Buffer.from(JSON.stringify({ exp, jti: randomUUID() })))
  return {
    access_token: `${corpo}.${assinar(corpo, chave)}`,
    token_type: 'Bearer',
    expires_in: VALIDADE_SEGUNDOS,
  }
}

export function tokenWebhookValido(
  cabecalhoAuthorization: string | null,
  agoraMs = Date.now(),
): boolean {
  const chave = segredo()
  if (!chave) return false
  if (!cabecalhoAuthorization?.startsWith('Bearer ')) return false

  const token = cabecalhoAuthorization.slice(7).trim()
  const [corpo, assinatura] = token.split('.')
  if (!corpo || !assinatura) return false
  if (!comparaSegura(assinatura, assinar(corpo, chave))) return false

  try {
    const dados = JSON.parse(Buffer.from(corpo, 'base64url').toString('utf8')) as { exp?: number }
    return typeof dados.exp === 'number' && dados.exp * 1000 > agoraMs
  } catch {
    return false
  }
}
