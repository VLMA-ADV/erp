// Fotos de colaboradores no navegador. O bucket `colaboradores-fotos` é
// PRIVADO e `people.colaboradores.foto_url` guarda o path do objeto (uploads
// novos) ou a URL pública antiga completa — nenhum dos dois abre num <img>
// nem num fetch sem antes virar signed URL. Mesma regra da edge
// (supabase/functions/_shared/fotos.ts), aqui com o cliente do front.

import { createClient } from '@/lib/supabase/client'

export const FOTO_BUCKET = 'colaboradores-fotos'

/** Path do objeto no bucket a partir do valor guardado; null se não houver foto. */
export function fotoPath(v: string | null | undefined): string | null {
  if (!v) return null
  const s = String(v).split('?')[0]
  const marker = `/${FOTO_BUCKET}/`
  const i = s.indexOf(marker)
  if (i >= 0) return s.slice(i + marker.length)
  if (!/^https?:\/\//i.test(s)) return s
  return null
}

/**
 * Assina em lote (1 chamada) e devolve valor original → signed URL. O que
 * não der para assinar fica de fora; nunca lança — foto é enfeite, não pode
 * derrubar o relatório.
 */
export async function assinarFotosColaboradores(
  valores: (string | null | undefined)[],
  segundos = 600,
): Promise<Map<string, string>> {
  const resultado = new Map<string, string>()
  const pathPorValor = new Map<string, string>()
  for (const v of valores) {
    if (!v || pathPorValor.has(v)) continue
    const p = fotoPath(v)
    if (p) pathPorValor.set(v, p)
  }
  const paths = Array.from(new Set(pathPorValor.values()))
  if (paths.length === 0) return resultado
  try {
    const supabase = createClient()
    const { data } = await supabase.storage.from(FOTO_BUCKET).createSignedUrls(paths, segundos)
    const porPath = new Map<string, string>()
    for (const s of data ?? []) if (s.path && s.signedUrl) porPath.set(s.path, s.signedUrl)
    for (const [valor, p] of pathPorValor) {
      const url = porPath.get(p)
      if (url) resultado.set(valor, url)
    }
  } catch {
    // sem assinatura: o relatório sai com iniciais
  }
  return resultado
}
