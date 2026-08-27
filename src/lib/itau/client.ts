import https from 'node:https'
import { randomUUID } from 'node:crypto'

/**
 * Cliente HTTP do Itaú (cobrança API v2).
 *
 * POR QUE ISSO VIVE AQUI E NÃO NUMA EDGE FUNCTION DO SUPABASE:
 * o Itaú exige mTLS — a chamada precisa apresentar um certificado de cliente.
 * Isso depende de controlar o socket TLS, o que o `fetch` do runtime Deno das
 * edge functions não expõe. O runtime Node da Vercel expõe, via
 * `https.request({ cert, key })`. Todo o resto da integração (emissão de
 * NFS-e, etc.) segue nas edge functions; só a conversa com o banco mora aqui,
 * e é por causa do certificado.
 *
 * NADA NESTE ARQUIVO FOI EXERCITADO CONTRA O BANCO. O token temporário do
 * pacote recebido em 14/08/2026 venceu em 02/06/2026, então o certificado
 * ainda não existe e nenhuma chamada real foi feita. O formato do payload,
 * esse sim, está testado (src/lib/itau/boleto-payload.test.ts) contra os
 * exemplos oficiais.
 *
 * Segredos só por variável de ambiente. O certificado e principalmente a
 * CHAVE PRIVADA nunca entram no repositório nem trafegam por mensagem.
 */

// MIGRACAO OBRIGATORIA ATE 15/09/2026.
// O portal do Itau anunciou a troca dos enderecos de conexao e da cadeia de
// certificados: 'api.itau.com.br' passa a ser 'api.gateway.itau.com.br'. Passada
// a data, o endereco antigo para de responder e a cobranca por boleto morre sem
// aviso — por isso ja migramos, e nao na vespera.
//
// Verificado em 27/08/2026 pelo endpoint de validacao que eles indicam:
//   GET https://api.gateway.itau.com.br/sandbox/ca-validation
//   -> HTTP 200 {"status":"OK"}, TLS autorizado, emissor
//      'GlobalSign GCC R46 OV TLS CA 2025' (a cadeia nova).
// O Node confia nessa CA por padrao, entao nao foi preciso importar truststore.
//
// 'sts.itau.com.br' (token) NAO esta na lista de enderecos impactados.
const ENDPOINTS = {
  producao: {
    token: 'https://sts.itau.com.br/api/oauth/token',
    boletos: 'https://api.gateway.itau.com.br/cash_management/v2/boletos',
    // CONSULTA NAO E O MESMO HOST DA EMISSAO. Levamos dias achando que era
    // permissao faltando — o 403 'Acesso a rota nao permitido' vinha de bater
    // GET no endereco de emissao, que so aceita POST. A equipe do Itau
    // esclareceu em 27/08 e as duas URLs abaixo responderam 200 na hora.
    consulta: 'https://secure.api.cloud.itau.com.br/boletoscash/v2/boletos',
    // "Francesinha": as datas em que houve movimentacao no mes. E por ela que
    // se descobre um pagamento sem depender do webhook.
    extrato: 'https://boleto.api.itau.com/extrato/v1',
    // Webhook segue indisponivel para a nossa credencial (403). Enquanto nao
    // liberarem, a baixa automatica sai da consulta acima.
    webhooks: 'https://api.gateway.itau.com.br/boletos/v3/notificacoes_boletos',
  },
  homologacao: {
    // O portal tem aba de homologacao em 'gestao de credenciais', mas nossa
    // credencial nasceu fora do portal (CSR por e-mail) e nao aparece la. Ate
    // existir uma credencial de homologacao de verdade, isto aponta para os
    // mesmos enderecos e quem decide o ambiente e a credencial usada.
    token: 'https://sts.itau.com.br/api/oauth/token',
    boletos: 'https://api.gateway.itau.com.br/cash_management/v2/boletos',
    consulta: 'https://secure.api.cloud.itau.com.br/boletoscash/v2/boletos',
    extrato: 'https://boleto.api.itau.com/extrato/v1',
    webhooks: 'https://api.gateway.itau.com.br/boletos/v3/notificacoes_boletos',
  },
} as const

export interface ItauConfigAmbiente {
  clientId: string
  clientSecret: string
  cert: string
  key: string
  ambiente: keyof typeof ENDPOINTS
}

/**
 * Lê as credenciais do ambiente. Devolve o que falta em vez de estourar, para
 * a tela poder dizer "falta ITAU_CERT_PEM" em vez de "erro interno".
 */
export function lerConfigItau():
  | { ok: true; config: ItauConfigAmbiente }
  | { ok: false; faltando: string[] } {
  const faltando: string[] = []
  const clientId = process.env.ITAU_CLIENT_ID ?? ''
  const clientSecret = process.env.ITAU_CLIENT_SECRET ?? ''
  // O PEM tem quebras de linha; em variável de ambiente elas costumam virar
  // "\n" literais. Desfazemos aqui para o Node aceitar o certificado.
  const cert = (process.env.ITAU_CERT_PEM ?? '').replace(/\\n/g, '\n')
  const key = (process.env.ITAU_KEY_PEM ?? '').replace(/\\n/g, '\n')

  if (!clientId) faltando.push('ITAU_CLIENT_ID')
  if (!clientSecret) faltando.push('ITAU_CLIENT_SECRET')
  if (!cert) faltando.push('ITAU_CERT_PEM')
  if (!key) faltando.push('ITAU_KEY_PEM')
  if (faltando.length) return { ok: false, faltando }

  const ambiente = process.env.ITAU_AMBIENTE === 'homologacao' ? 'homologacao' : 'producao'
  return { ok: true, config: { clientId, clientSecret, cert, key, ambiente } }
}

export interface RespostaItau {
  status: number
  corpo: unknown
  corpoBruto: string
}

/** Um POST com certificado de cliente. Sem dependência externa de propósito. */
function requisicaoMtls(
  url: string,
  config: ItauConfigAmbiente,
  headers: Record<string, string>,
  // GET nao tem corpo; vazio nao escreve nada no socket.
  corpo = '',
  timeoutMs = 30_000,
): Promise<RespostaItau> {
  const alvo = new URL(url)
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        method: 'POST',
        host: alvo.hostname,
        path: alvo.pathname + alvo.search,
        port: alvo.port || 443,
        cert: config.cert,
        key: config.key,
        headers: { ...headers, 'Content-Length': Buffer.byteLength(corpo).toString() },
        timeout: timeoutMs,
      },
      (res) => {
        const partes: Buffer[] = []
        res.on('data', (c) => partes.push(c))
        res.on('end', () => {
          const bruto = Buffer.concat(partes).toString('utf8')
          let parsed: unknown = null
          try {
            parsed = bruto ? JSON.parse(bruto) : null
          } catch {
            parsed = null // resposta não-JSON (HTML de erro de gateway, por ex.)
          }
          resolve({ status: res.statusCode ?? 0, corpo: parsed, corpoBruto: bruto })
        })
      },
    )
    req.on('timeout', () => {
      // Sem isto o socket fica pendurado até o limite da função e o usuário
      // não sabe se o boleto foi registrado ou não.
      req.destroy(new Error(`Itaú não respondeu em ${timeoutMs / 1000}s`))
    })
    req.on('error', reject)
    req.write(corpo)
    req.end()
  })
}

// Cache do token por instância. O access_token do Itaú dura minutos; pedir um
// novo a cada boleto de um lote de 80 faturas é desperdício e chama atenção do
// controle de vazão do banco. A margem de 60s evita usar um token que expira
// no meio da chamada seguinte.
let tokenCache: { valor: string; expiraEm: number } | null = null

export async function obterAccessToken(config: ItauConfigAmbiente): Promise<string> {
  const agora = Date.now()
  if (tokenCache && tokenCache.expiraEm > agora + 60_000) return tokenCache.valor

  const corpo = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: config.clientId,
    client_secret: config.clientSecret,
  }).toString()

  const r = await requisicaoMtls(ENDPOINTS[config.ambiente].token, config, {
    'Content-Type': 'application/x-www-form-urlencoded',
    'x-itau-flowID': randomUUID(),
    'x-itau-correlationID': randomUUID(),
  }, corpo)

  if (r.status !== 200) {
    throw new Error(`Itaú recusou as credenciais (HTTP ${r.status}): ${r.corpoBruto.slice(0, 300)}`)
  }

  const dados = (r.corpo ?? {}) as { access_token?: string; expires_in?: number }
  if (!dados.access_token) throw new Error('Itaú não devolveu access_token.')

  const duracao = Number(dados.expires_in ?? 300) * 1000
  tokenCache = { valor: dados.access_token, expiraEm: agora + duracao }
  return dados.access_token
}

/** Só para teste: descarta o token guardado. */
export function limparTokenCache() {
  tokenCache = null
}

export async function emitirBoleto(
  config: ItauConfigAmbiente,
  payload: Record<string, unknown>,
): Promise<RespostaItau & { correlationId: string }> {
  const token = await obterAccessToken(config)
  const correlationId = randomUUID()

  const r = await requisicaoMtls(ENDPOINTS[config.ambiente].boletos, config, {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Authorization: `Bearer ${token}`,
    // O Itaú usa o próprio client_id como chave de API neste header. É o que a
    // coleção oficial faz ({{client_id}}); está na lista de confirmações
    // pendentes com o banco.
    'x-itau-apikey': config.clientId,
    'x-itau-correlationID': correlationId,
    'x-itau-flowID': randomUUID(),
  }, JSON.stringify(payload))

  return { ...r, correlationId }
}

/**
 * Consulta um boleto pelo nosso número.
 *
 * ATENÇÃO AO HOST: consulta NÃO é o mesmo endereço da emissão. Bater GET no de
 * emissão devolve 403 "Acesso a rota não permitido" — mensagem que parece falta
 * de permissão e não é. Custou dias e um pedido de liberação desnecessário ao
 * banco antes de a equipe do Itaú esclarecer, em 27/08.
 *
 * `view=specific` traz os dados de pagamento do título; sem ele vem só o resumo.
 */
export async function consultarBoleto(
  config: ItauConfigAmbiente,
  params: { idBeneficiario: string; codigoCarteira: string; nossoNumero: string },
): Promise<RespostaItau & { correlationId: string }> {
  const token = await obterAccessToken(config)
  const correlationId = randomUUID()

  const url =
    `${ENDPOINTS[config.ambiente].consulta}` +
    `?id_beneficiario=${encodeURIComponent(params.idBeneficiario)}` +
    `&codigo_carteira=${encodeURIComponent(params.codigoCarteira)}` +
    `&nosso_numero=${encodeURIComponent(params.nossoNumero)}` +
    `&view=specific`

  const r = await requisicaoMtls(url, config, {
    Accept: 'application/json',
    Authorization: `Bearer ${token}`,
    'x-itau-apikey': config.clientId,
    'x-itau-correlationID': correlationId,
    'x-itau-correlationid': correlationId,
    'x-itau-flowID': randomUUID(),
  })

  return { ...r, correlationId }
}

/**
 * Lê o desfecho de uma consulta e diz se o título foi pago.
 *
 * O Itaú varia o nível do envelope e o nome dos campos entre as views, então
 * procuramos em vez de assumir um caminho fixo — mesma estratégia de
 * `lerRespostaEmissao`. Na dúvida, devolvemos "não pago": marcar como recebido
 * o que não foi é pior do que deixar para a conferência humana.
 */
export function lerPagamentoDaConsulta(corpo: unknown): {
  pago: boolean
  valorPago: number | null
  dataCredito: string | null
} {
  const naoPago = { pago: false, valorPago: null, dataCredito: null }
  if (!corpo || typeof corpo !== 'object') return naoPago

  const achar = (o: unknown, chaves: string[]): unknown => {
    if (!o || typeof o !== 'object') return undefined
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (chaves.includes(k) && v != null && v !== '') return v
      if (typeof v === 'object') {
        const achado = achar(v, chaves)
        if (achado !== undefined) return achado
      }
    }
    return undefined
  }

  const num = (v: unknown): number | null => {
    if (v == null) return null
    const n = Number(String(v).replace(',', '.'))
    return Number.isFinite(n) && n > 0 ? n : null
  }

  const valorPago = num(achar(corpo, ['valor_pago_total_cobranca', 'valorPagoTotalCobranca', 'valor_pago']))
  const dataCredito = (achar(corpo, ['data_credito', 'dataCredito', 'data_inclusao_pagamento']) as string) ?? null
  const situacao = String(achar(corpo, ['codigo_situacao', 'situacao', 'status']) ?? '').toLowerCase()

  const pago = valorPago != null || /liquidad|pago|baixa/.test(situacao)
  return pago ? { pago, valorPago, dataCredito } : naoPago
}
