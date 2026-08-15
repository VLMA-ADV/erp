import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { emitirBoleto, lerConfigItau } from '@/lib/itau/client'
import {
  lerRespostaEmissao,
  montarPayloadEmissao,
  type BoletoConfig,
  type BoletoPagador,
  type BoletoTitulo,
} from '@/lib/itau/boleto-payload'

// mTLS (certificado de cliente) só existe no runtime Node — ver o comentário
// em src/lib/itau/client.ts. Sem isto a Vercel poderia rodar isto no edge e a
// chamada ao Itaú falharia sem explicação óbvia.
export const runtime = 'nodejs'

/**
 * Registra o boleto de um lançamento a receber no Itaú.
 *
 * A ordem importa e é esta de propósito:
 *   1. bol_preparar reserva o nosso número numa transação (dois cliques não
 *      geram dois boletos);
 *   2. o payload é montado e validado localmente — cadastro de cliente
 *      incompleto morre aqui, sem gastar chamada ao banco;
 *   3. só então o Itaú é chamado;
 *   4. bol_registrar grava o desfecho, dando certo ou errado.
 *
 * O passo 4 acontece inclusive quando o passo 2 falha: senão o boleto ficaria
 * eternamente 'preparado' e travaria qualquer nova tentativa para aquele
 * lançamento (o índice parcial só libera quando o status vira 'erro').
 */
export async function POST(req: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user }, error: userErr } = await supabase.auth.getUser()
  if (userErr || !user) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const lancamentoId = (body as { lancamento_id?: string }).lancamento_id
  if (!lancamentoId) {
    return NextResponse.json({ error: 'lancamento_id é obrigatório' }, { status: 400 })
  }

  const cfgAmbiente = lerConfigItau()
  if (!cfgAmbiente.ok) {
    return NextResponse.json(
      {
        error: 'Integração com o Itaú não está configurada no servidor.',
        faltando: cfgAmbiente.faltando,
      },
      { status: 503 },
    )
  }

  // bol_preparar já checa permissão (finance.nfse.manage), estado do
  // lançamento e boleto duplicado, e devolve mensagem pronta para a tela.
  const { data: prep, error: prepErr } = await supabase.rpc('bol_preparar', {
    p_user_id: user.id,
    p_lancamento_id: lancamentoId,
  })
  if (prepErr || !prep) {
    return NextResponse.json({ error: prepErr?.message ?? 'Não foi possível preparar o boleto' }, { status: 422 })
  }

  const preparado = prep as {
    boleto_id: string
    config: Record<string, any>
    titulo: BoletoTitulo
    pagador: BoletoPagador
  }
  const boletoId = preparado.boleto_id

  const registrar = (payload: unknown, resposta: unknown, erro: string | null) =>
    supabase.rpc('bol_registrar', {
      p_user_id: user.id,
      p_boleto_id: boletoId,
      p_payload: payload ?? null,
      p_resposta: resposta ?? null,
      p_erro: erro,
    })

  let payload: Record<string, unknown>
  try {
    payload = montarPayloadEmissao({
      config: configDoBanco(preparado.config),
      pagador: preparado.pagador,
      titulo: preparado.titulo,
      etapa: 'efetivacao',
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Payload inválido'
    await registrar(null, null, msg)
    return NextResponse.json({ error: msg, boleto_id: boletoId }, { status: 422 })
  }

  let resposta
  try {
    resposta = await emitirBoleto(cfgAmbiente.config, payload)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Falha ao falar com o Itaú'
    await registrar(payload, null, msg)
    return NextResponse.json({ error: msg, boleto_id: boletoId }, { status: 502 })
  }

  if (resposta.status < 200 || resposta.status >= 300) {
    const msg = `Itaú recusou o boleto (HTTP ${resposta.status}).`
    await registrar(payload, resposta.corpo ?? { corpo_bruto: resposta.corpoBruto.slice(0, 2000) }, msg)
    return NextResponse.json(
      { error: msg, detalhe: resposta.corpo ?? resposta.corpoBruto.slice(0, 2000), boleto_id: boletoId },
      { status: 422 },
    )
  }

  const registrado = lerRespostaEmissao(resposta.corpo)
  const { data: linha, error: regErr } = await registrar(payload, { ...registrado, bruto: resposta.corpo }, null)
  if (regErr) {
    // O boleto EXISTE no banco mas não conseguimos gravar. Não pode voltar 200:
    // a tela mostraria sucesso e ninguém saberia que o registro local ficou
    // para trás. O correlationId é o que o Itaú pede para rastrear depois.
    return NextResponse.json(
      {
        error: 'Boleto registrado no Itaú, mas falhou ao gravar no ERP. Anote e avise o suporte.',
        correlation_id: resposta.correlationId,
        boleto_id: boletoId,
        detalhe: regErr.message,
      },
      { status: 500 },
    )
  }

  return NextResponse.json({ boleto: linha })
}

/** Achata a linha de finance.boleto_config no formato que o montador espera. */
function configDoBanco(c: Record<string, any>): BoletoConfig {
  const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v))
  return {
    id_beneficiario: String(c.id_beneficiario ?? ''),
    codigo_carteira: String(c.codigo_carteira ?? '109'),
    codigo_especie: String(c.codigo_especie ?? '01'),
    juros: c.juros_ativo
      ? {
          codigo_tipo: String(c.juros_codigo_tipo ?? '90'),
          dias: num(c.juros_dias) || 1,
          percentual_mes: num(c.juros_percentual_mes),
        }
      : null,
    multa:
      c.multa_tipo === 'percentual'
        ? { codigo_tipo: '02', dias: num(c.multa_dias) || 1, percentual: num(c.multa_percentual) }
        : c.multa_tipo === 'valor'
          ? { codigo_tipo: '01', dias: num(c.multa_dias) || 1, valor: num(c.multa_valor) }
          : null,
    instrucoes: Array.isArray(c.instrucoes)
      ? c.instrucoes.map((i: Record<string, any>) => ({
          codigo: String(i.codigo ?? ''),
          dias_apos_vencimento: num(i.dias_apos_vencimento),
          dia_util: Boolean(i.dia_util),
        }))
      : [],
    recebimento_divergente_codigo: c.recebimento_divergente ? String(c.recebimento_divergente) : null,
    dias_limite_pagamento: c.dias_limite_pagamento === null || c.dias_limite_pagamento === undefined
      ? null
      : Number(c.dias_limite_pagamento),
    desconto_expresso: Boolean(c.desconto_expresso),
  }
}
