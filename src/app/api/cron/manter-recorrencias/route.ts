import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

/**
 * Mantém o horizonte das despesas recorrentes sem prazo.
 *
 * cp_gerar_parcelas roda uma única vez, na criação, e gera 12 meses. Para a
 * recorrência sem data final isso significa que ela ACABA — hoje, todas as 30
 * do escritório terminam entre junho e julho de 2027. De lá em diante o fluxo
 * de caixa mostraria zero despesa fixa, e o caixa projetado pareceria bem
 * melhor do que é, sem nada avisando.
 *
 * Este cron empurra o horizonte todo dia: garante ~12 meses de parcelas à
 * frente de hoje. A RPC é idempotente pela chave (recorrencia_id,
 * parcela_numero), então rodar de novo no mesmo dia não duplica nada.
 */
export async function GET(req: NextRequest) {
  const segredo = process.env.CRON_SECRET
  if (segredo && req.headers.get('authorization') !== `Bearer ${segredo}`) {
    return NextResponse.json({ error: 'não autorizado' }, { status: 401 })
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !chave) {
    return NextResponse.json({ error: 'servidor sem configuração' }, { status: 500 })
  }

  const supabase = createClient(url, chave)
  // p_user_id nulo: o cron não tem usuário logado, então a RPC percorre todos
  // os tenants e usa o created_by do lançamento base de cada recorrência.
  const { data, error } = await supabase.rpc('cp_manter_recorrencias', {
    p_user_id: null,
    p_horizonte_meses: 12,
  })

  if (error) {
    return NextResponse.json({ ok: false, erro: error.message }, { status: 502 })
  }
  return NextResponse.json({ ok: true, ...(data as object) })
}
