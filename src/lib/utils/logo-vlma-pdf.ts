// Marca do VLMA nos PDFs gerados com pdf-lib (relatório de timesheet e nota
// de débito). Filipe, 28/09: "precisa vir a logo do VLMA que se perdeu nessa
// atualização" — os PDFs escreviam só o texto "VLMA" no lugar do SVG que o
// timbre em HTML (documento-vlma.ts) sempre teve. Aqui os mesmos dois
// caminhos SVG são desenhados direto no PDF, como vetor, cada um com sua cor.

import { rgb, type PDFPage, type RGB } from 'pdf-lib'
import { LOGO_VLMA } from './documento-vlma'

/** '#FF9900' → rgb(1, 0.6, 0) do pdf-lib. */
function corHex(hex: string): RGB {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16)
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255)
}

/** Largura da marca no cabeçalho do papel timbrado (mesma altura do bloco do emitente). */
export const LOGO_LARGURA_TIMBRE = 110

/** Altura que a marca ocupa para uma dada largura (proporção do viewBox). */
export function alturaLogoVlma(largura: number): number {
  return (largura * LOGO_VLMA.viewBox.altura) / LOGO_VLMA.viewBox.largura
}

/**
 * Desenha a marca com o canto SUPERIOR esquerdo em (x, y), no sistema de
 * coordenadas do PDF (y cresce para cima). `drawSvgPath` do pdf-lib usa o
 * ponto dado como origem do SVG e cresce para baixo, o que é exatamente o
 * canto superior esquerdo — por isso não há conversão além da escala.
 */
export function desenharLogoVlma(pagina: PDFPage, opcoes: { x: number; y: number; largura: number }): void {
  const scale = opcoes.largura / LOGO_VLMA.viewBox.largura
  for (const p of LOGO_VLMA.paths) {
    pagina.drawSvgPath(p.d, { x: opcoes.x, y: opcoes.y, scale, color: corHex(p.cor), borderWidth: 0 })
  }
}
