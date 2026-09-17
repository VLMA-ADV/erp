import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { emitirBoleto, emitirBoletoPix, lerConfigItau } from '@/lib/itau/client'
import { montarPayloadEmissao, type BoletoConfig, type BoletoPagador, type BoletoTitulo } from '@/lib/itau/boleto-payload'

// mTLS só existe no runtime Node — mesma razão da rota de emissão.
export const runtime = 'nodejs'

/**
 * Confere o payload no Itaú SEM registrar boleto.
 *
 * A API do banco tem duas etapas: 'validacao' apenas valida os campos e
 * 'efetivacao' registra o título. Esta rota usa a primeira. Serve para
 * descobrir o formato que o banco espera — foi assim que apareceu o acento
 * recusado em texto_uso_beneficiario (03/09) — e agora para confirmar o bloco
 * de Pix do BoleCode antes de ligar a novidade para o escritório.
 *
 * Aceita `chave_pix` e `bolecode` no corpo para testar a combinação sem
 * precisar gravar nada na configuração.
 */
export async function POST(req: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user }, error: userErr } = await supabase.auth.getUser()
  if (userErr || !user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const { lancamento_id: lancamentoId, chave_pix: chavePix, bolecode, via_recebimentos: viaRecebimentos } =
    body as { lancamento_id?: string; chave_pix?: string; bolecode?: boolean; via_recebimentos?: boolean }
  if (!lancamentoId) return NextResponse.json({ error: 'lancamento_id é obrigatório' }, { status: 400 })

  const cfgAmbiente = lerConfigItau()
  if (!cfgAmbiente.ok) {
    return NextResponse.json(
      { error: 'Integração com o Itaú não está configurada no servidor.', faltando: cfgAmbiente.faltando },
      { status: 503 },
    )
  }

  // bol_preparar reserva nosso número e devolve config, título e pagador —
  // o mesmo caminho da emissão, para o teste valer de alguma coisa.
  const { data: prep, error: prepErr } = await supabase.rpc('bol_preparar', {
    p_user_id: user.id,
    p_lancamento_id: lancamentoId,
  })
  if (prepErr || !prep) {
    return NextResponse.json({ error: prepErr?.message ?? 'Não foi possível preparar o boleto' }, { status: 422 })
  }

  const preparado = prep as {
    boleto_id: string
    config: Record<string, unknown>
    titulo: BoletoTitulo
    pagador: BoletoPagador
  }

  // O boleto 'preparado' desta validação não vira título: marca como erro para
  // não travar uma emissão de verdade do mesmo lançamento (o índice parcial só
  // libera quando o status sai de 'preparado').
  const encerrarReserva = (erro: string) =>
    supabase.rpc('bol_registrar', {
      p_user_id: user.id,
      p_boleto_id: preparado.boleto_id,
      p_payload: null,
      p_resposta: null,
      p_erro: erro,
    })

  const config = {
    ...(preparado.config as unknown as BoletoConfig),
    ...(typeof bolecode === 'boolean' ? { bolecode_ativo: bolecode } : {}),
    ...(chavePix ? { chave_pix: chavePix } : {}),
  } as BoletoConfig

  let payload: Record<string, unknown>
  try {
    payload = montarPayloadEmissao({
      config,
      pagador: preparado.pagador,
      titulo: preparado.titulo,
      etapa: 'validacao',
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Payload inválido'
    await encerrarReserva(`Validação: ${msg}`)
    return NextResponse.json({ error: msg }, { status: 422 })
  }

  try {
    // Boleto com Pix vive na API de Recebimentos e chama a etapa de teste de
    // 'simulacao' (a de boleto comum chama 'validacao'). Nos dois casos nada
    // e gerado: roda as validacoes e devolve os dados de saida.
    const dados = payload.data as Record<string, unknown>
    if (viaRecebimentos) dados.etapa_processo_boleto = 'simulacao'

    const resposta = viaRecebimentos
      ? await emitirBoletoPix(cfgAmbiente.config, payload)
      : await emitirBoleto(cfgAmbiente.config, payload)
    await encerrarReserva(viaRecebimentos
      ? 'Simulação de BoleCode (não gera boleto nem Pix)'
      : 'Validação de payload (não registra boleto)')
    return NextResponse.json({
      etapa: viaRecebimentos ? 'simulacao' : 'validacao',
      api: viaRecebimentos ? 'recebimentos (boletos-pix)' : 'cash_management (boletos)',
      http_status: resposta.status,
      aceito: resposta.status >= 200 && resposta.status < 300,
      payload_enviado: payload,
      resposta: resposta.corpo ?? resposta.corpoBruto.slice(0, 4000),
      correlation_id: resposta.correlationId,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Falha ao falar com o Itaú'
    await encerrarReserva(`Validação: ${msg}`)
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
