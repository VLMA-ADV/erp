import { NextRequest, NextResponse } from 'next/server'
import { statusCertificadoItau } from '@/lib/itau/certificado'

export const runtime = 'nodejs'

/**
 * Lembrete de renovação do certificado do Itaú.
 *
 * Roda uma vez por dia (vercel.json) e só faz barulho quando falta pouco. A
 * ideia não é informar todo dia — é garantir que a janela de renovação, que
 * abre 30 dias antes do vencimento e acontece uma vez por ano, não passe
 * despercebida.
 *
 * Escada de avisos:
 *   45 dias  -> começa a lembrar, uma vez por semana (às segundas)
 *   30 dias  -> a janela abriu no Itaú: lembra TODO dia
 *   vencido  -> avisa todo dia que os boletos pararam
 *
 * O e-mail sai pela edge function, onde mora a chave do Resend. Este endpoint
 * não conhece a chave.
 */
export async function GET(req: NextRequest) {
  // A Vercel manda o CRON_SECRET no Authorization. Sem ele, qualquer um na
  // internet dispararia e-mail para o financeiro.
  const segredo = process.env.CRON_SECRET
  if (segredo && req.headers.get('authorization') !== `Bearer ${segredo}`) {
    return NextResponse.json({ error: 'não autorizado' }, { status: 401 })
  }

  const s = statusCertificadoItau()
  if (!s.configurado) return NextResponse.json({ avisou: false, motivo: 'certificado não configurado' })

  const dias = s.dias_restantes ?? 0
  const hoje = new Date().getUTCDay() // 1 = segunda
  const vencido = dias < 0

  let deveAvisar = false
  if (s.erro || vencido) deveAvisar = true
  else if (dias <= 30) deveAvisar = true
  else if (dias <= 45) deveAvisar = hoje === 1

  if (!deveAvisar) return NextResponse.json({ avisou: false, dias_restantes: dias })

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !chave) {
    return NextResponse.json({ error: 'servidor sem configuração' }, { status: 500 })
  }

  const r = await fetch(`${url}/functions/v1/avisar-certificado-itau`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      dias_restantes: dias,
      vence_em: s.vence_em,
      pode_renovar: s.pode_renovar,
      erro: s.erro,
    }),
  })

  const corpo = await r.json().catch(() => null)
  return NextResponse.json({ avisou: r.ok, dias_restantes: dias, resposta: corpo }, { status: r.ok ? 200 : 502 })
}
