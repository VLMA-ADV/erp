import { X509Certificate } from 'node:crypto'
import process from 'node:process'

/**
 * Estado do certificado mTLS do Itaú.
 *
 * O certificado vale 365 dias e a renovação só é aceita nos ÚLTIMOS 30 DIAS
 * antes do vencimento, pelo endpoint v2 do STS. Passou da data, é recomeçar o
 * processo inteiro com o banco: pedir token novo, gerar CSR, esperar.
 *
 * Ou seja: existe uma janela de 30 dias, uma vez por ano, em que alguém tem de
 * agir — e no resto do tempo nada lembra ninguém disso. É exatamente o tipo de
 * coisa que quebra calada. Por isso este arquivo existe: a tela avisa e o robô
 * manda e-mail antes de a janela abrir.
 */
export interface StatusCertificado {
  configurado: boolean
  valido: boolean
  vence_em: string | null
  dias_restantes: number | null
  /** A renovação no Itaú só abre 30 dias antes. */
  pode_renovar: boolean
  emitido_para: string | null
  erro: string | null
}

const AVISO_DIAS = 60

export function statusCertificadoItau(agora = new Date()): StatusCertificado {
  const vazio: StatusCertificado = {
    configurado: false, valido: false, vence_em: null, dias_restantes: null,
    pode_renovar: false, emitido_para: null, erro: null,
  }

  const pem = (process.env.ITAU_CERT_PEM ?? '').replace(/\\n/g, '\n').trim()
  if (!pem) return vazio

  try {
    const cert = new X509Certificate(pem)
    const validoAte = new Date(cert.validTo)
    const dias = Math.floor((validoAte.getTime() - agora.getTime()) / 86_400_000)
    return {
      configurado: true,
      valido: validoAte > agora && new Date(cert.validFrom) <= agora,
      vence_em: validoAte.toISOString().slice(0, 10),
      dias_restantes: dias,
      pode_renovar: dias <= 30,
      // O CN é o client_id; serve para conferir que o certificado no ambiente
      // é o da credencial certa, quando houver mais de uma.
      emitido_para: cert.subject.split('\n').find((l) => l.startsWith('CN='))?.slice(3) ?? null,
      erro: null,
    }
  } catch (e) {
    return { ...vazio, configurado: true, erro: e instanceof Error ? e.message : 'certificado ilegível' }
  }
}

/** Vale mostrar aviso na tela? */
export function precisaAvisar(s: StatusCertificado): boolean {
  if (!s.configurado) return false
  if (s.erro) return true
  return s.dias_restantes !== null && s.dias_restantes <= AVISO_DIAS
}
