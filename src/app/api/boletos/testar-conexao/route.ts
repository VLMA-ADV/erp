import { NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { lerConfigItau, obterAccessToken, limparTokenCache } from '@/lib/itau/client'
import { statusCertificadoItau } from '@/lib/itau/certificado'

export const runtime = 'nodejs'

/**
 * Testa a conexão com o Itaú sem emitir nada.
 *
 * Pede um access_token ao STS, que é a única chamada que exerce o caminho
 * inteiro — mTLS com o certificado, credencial aceita, resposta do banco — sem
 * criar um boleto de verdade. Como não existe ambiente de homologação nesta
 * API (a credencial já nasce apontando para produção), é o mais perto que dá
 * de "testar" sem cobrar alguém.
 *
 * NÃO devolve o token. Só diz se veio, e por quanto tempo vale.
 */
export async function GET() {
  const supabase = await createServerClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

  const podeGerir = await supabase.rpc('tem_capacidade_sensivel', {
    p_user_id: user.id,
    p_capacidade: 'finance.nfse.manage',
  })
  if (podeGerir.data !== true) {
    return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })
  }

  const cfg = lerConfigItau()
  if (!cfg.ok) {
    return NextResponse.json({ ok: false, etapa: 'configuração', faltando: cfg.faltando }, { status: 422 })
  }

  const cert = statusCertificadoItau()
  if (cert.erro || !cert.valido) {
    return NextResponse.json(
      { ok: false, etapa: 'certificado', detalhe: cert.erro ?? 'certificado fora da validade', certificado: cert },
      { status: 422 },
    )
  }

  const inicio = Date.now()
  try {
    // Cache limpo de propósito: um teste que devolve o token guardado de dez
    // minutos atrás não testa nada.
    limparTokenCache()
    await obterAccessToken(cfg.config)
    return NextResponse.json({
      ok: true,
      etapa: 'access_token',
      ambiente: cfg.config.ambiente,
      ms: Date.now() - inicio,
      certificado: { vence_em: cert.vence_em, dias_restantes: cert.dias_restantes },
    })
  } catch (e) {
    // Quando o banco recusa a credencial, a pergunta seguinte é sempre "mas o
    // valor certo chegou aqui?". Como variável de ambiente não se lê depois de
    // salva, o tamanho responde isso sem expor nada: o client_secret do Itaú
    // tem 36 caracteres. Se chegar 43, veio com o rótulo "Secret:" colado —
    // foi o que aconteceu na primeira tentativa.
    const tamanhos = {
      client_id: (process.env.ITAU_CLIENT_ID ?? '').trim().length,
      client_secret: (process.env.ITAU_CLIENT_SECRET ?? '').trim().length,
      client_secret_esperado: 36,
      client_secret_com_rotulo: (process.env.ITAU_CLIENT_SECRET ?? '').trim().toLowerCase().startsWith('secret:'),
    }
    return NextResponse.json(
      {
        ok: false,
        etapa: 'access_token',
        detalhe: e instanceof Error ? e.message : 'falha desconhecida',
        ms: Date.now() - inicio,
        tamanhos,
      },
      { status: 502 },
    )
  }
}
