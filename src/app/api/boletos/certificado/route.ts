import { NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { statusCertificadoItau } from '@/lib/itau/certificado'

// X509Certificate é do node:crypto — não existe no runtime edge.
export const runtime = 'nodejs'

/**
 * Quanto tempo resta no certificado do Itaú.
 *
 * Só para quem está logado: o vencimento não é segredo, mas o CN é o
 * client_id da credencial e não precisa ficar aberto na internet.
 */
export async function GET() {
  const supabase = await createServerClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

  return NextResponse.json(statusCertificadoItau())
}
