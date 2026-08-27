import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { consultarBoleto, lerPagamentoDaConsulta, lerConfigItau } from '@/lib/itau/client'

// mTLS só existe no runtime Node — ver o comentário em src/lib/itau/client.ts.
export const runtime = 'nodejs'

/**
 * Baixa automática dos boletos pagos.
 *
 * POR QUE ISTO EXISTE, E NÃO O WEBHOOK: o webhook do Itaú notifica o pagamento
 * na hora, mas o endpoint de cadastro dele não responde para a nossa credencial
 * (403 em todos os endereços que testamos, incluindo o host de consulta — onde
 * uma rota inventada devolve o mesmo 403, então é "não existe aqui", não
 * "sem permissão"). Perguntamos ao banco qual é a URL correta.
 *
 * Enquanto não vem resposta, a consulta resolve o mesmo problema puxando em vez
 * de esperar: uma vez por dia, todo boleto em aberto é consultado, e o que
 * estiver pago vira baixa. A diferença prática é latência — o pagamento aparece
 * no dia seguinte, não em segundos. Para conferência de faturamento mensal,
 * isso basta.
 *
 * Quando o webhook for liberado, os dois caminhos convivem: ambos terminam em
 * bol_aplicar_notificacao, que ignora boleto já liquidado.
 */
export async function GET(req: NextRequest) {
  const segredo = process.env.CRON_SECRET
  if (segredo && req.headers.get('authorization') !== `Bearer ${segredo}`) {
    return NextResponse.json({ error: 'não autorizado' }, { status: 401 })
  }

  const cfg = lerConfigItau()
  if (!cfg.ok) {
    return NextResponse.json({ error: 'Itaú não configurado', faltando: cfg.faltando }, { status: 503 })
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !chave) {
    return NextResponse.json({ error: 'servidor sem configuração' }, { status: 500 })
  }
  const db = createClient(url, chave, { auth: { persistSession: false } })

  // Só o que ainda pode virar dinheiro: registrado e não liquidado. Boleto com
  // erro na emissão não existe no banco e consultá-lo seria chamada perdida.
  const { data: abertos, error: erroLista } = await db
    .schema('finance')
    .from('boletos')
    .select('id, tenant_id, nosso_numero, valor, vencimento, status')
    .in('status', ['registrado', 'aberto'])
    .limit(300)

  if (erroLista) {
    return NextResponse.json({ error: erroLista.message }, { status: 500 })
  }
  if (!abertos?.length) {
    return NextResponse.json({ verificados: 0, baixados: 0, detalhe: 'nenhum boleto em aberto' })
  }

  const { data: config } = await db
    .schema('finance')
    .from('boleto_config')
    .select('tenant_id, id_beneficiario, codigo_carteira')

  const porTenant = new Map((config ?? []).map((c) => [c.tenant_id, c]))

  let baixados = 0
  const erros: Array<{ nosso_numero: string; erro: string }> = []

  for (const b of abertos) {
    const cfgTenant = porTenant.get(b.tenant_id)
    if (!cfgTenant?.id_beneficiario) continue

    try {
      const r = await consultarBoleto(cfg.config, {
        idBeneficiario: cfgTenant.id_beneficiario,
        codigoCarteira: cfgTenant.codigo_carteira ?? '109',
        nossoNumero: b.nosso_numero,
      })
      if (r.status < 200 || r.status >= 300) {
        erros.push({ nosso_numero: b.nosso_numero, erro: `HTTP ${r.status}` })
        continue
      }

      const pgto = lerPagamentoDaConsulta(r.corpo)
      if (!pgto.pago) continue

      // Mesma porta do webhook: ela já ignora boleto liquidado e move o
      // lançamento para 'recebido'.
      const { error: erroBaixa } = await db.rpc('bol_aplicar_notificacao', {
        p_notificacao: {
          nosso_numero: b.nosso_numero,
          valor_pago: pgto.valorPago,
          data_credito: pgto.dataCredito,
          origem: 'consulta_diaria',
        },
      })
      if (erroBaixa) {
        erros.push({ nosso_numero: b.nosso_numero, erro: erroBaixa.message })
        continue
      }
      baixados += 1
    } catch (e) {
      erros.push({ nosso_numero: b.nosso_numero, erro: e instanceof Error ? e.message : 'falha' })
    }
  }

  return NextResponse.json({
    verificados: abertos.length,
    baixados,
    erros: erros.length ? erros.slice(0, 20) : undefined,
  })
}
