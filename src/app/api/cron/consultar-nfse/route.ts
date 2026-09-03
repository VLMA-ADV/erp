import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

/**
 * Busca na Focus o desfecho das NFS-e enviadas.
 *
 * POR QUE ISTO EXISTE: a emissão grava só o status do envio
 * ("processando_autorizacao"). O número e o PDF da nota só existem depois que a
 * prefeitura autoriza, e nada perguntava isso sozinho — o único lugar que
 * consultava era um botão manual em "Notas geradas".
 *
 * Efeito prático até 03/09: emitia-se a nota e o arquivo nunca aparecia na
 * composição da fatura, travando o kit que vai ao cliente. O Filipe reportou
 * como "emiti NF mas não apareceu o arquivo".
 *
 * De hora em hora é suficiente: autorização de NFS-e leva minutos, e quem tem
 * pressa continua tendo o botão manual.
 */
export async function GET(req: NextRequest) {
  const segredo = process.env.CRON_SECRET
  if (segredo && req.headers.get('authorization') !== `Bearer ${segredo}`) {
    return NextResponse.json({ error: 'não autorizado' }, { status: 401 })
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY
  const tenant = process.env.VLMA_TENANT_ID ?? 'd51463dd-a6b3-40e7-9488-854eba80a210'
  if (!url || !chave) {
    return NextResponse.json({ error: 'servidor sem configuração' }, { status: 500 })
  }

  const r = await fetch(`${url}/functions/v1/consultar-nfse`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenant_id: tenant }),
  })
  const corpo = await r.json().catch(() => null)
  return NextResponse.json({ ok: r.ok, resposta: corpo }, { status: r.ok ? 200 : 502 })
}
