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

  const status = statusCertificadoItau()

  // Quando o certificado não abre, o erro do OpenSSL ("no start line") não diz
  // o que houve de fato — e a causa é quase sempre a mesma: o PEM chegou
  // truncado ou sem as quebras de linha, porque foi colado à mão num formulário.
  // Estes campos descrevem o FORMATO, nunca o conteúdo: nada aqui identifica a
  // chave nem serve para reconstruí-la.
  const formato = (bruto: string | undefined, tipo: string) => {
    const v = (bruto ?? '').replace(/\\n/g, '\n')
    if (!v) return { presente: false }
    return {
      presente: true,
      caracteres: v.length,
      linhas: v.split('\n').length,
      comeca_com_begin: v.trimStart().startsWith(`-----BEGIN ${tipo}`),
      termina_com_end: v.trimEnd().endsWith(`-----END ${tipo}-----`),
      tem_aspas_sobrando: v.trim().startsWith('"') || v.trim().startsWith("'"),
    }
  }

  return NextResponse.json({
    ...status,
    diagnostico: status.erro
      ? {
          certificado: formato(process.env.ITAU_CERT_PEM, 'CERTIFICATE'),
          chave: formato(process.env.ITAU_KEY_PEM, 'PRIVATE KEY'),
          client_id_presente: Boolean(process.env.ITAU_CLIENT_ID),
          client_secret_presente: Boolean(process.env.ITAU_CLIENT_SECRET),
        }
      : undefined,
  })
}
