// Fotos de colaboradores ficam no bucket PRIVADO `colaboradores-fotos`.
// `people.colaboradores.foto_url` guarda o path do objeto (uploads novos) ou,
// em registros antigos, a URL pública completa. Nenhum dos dois abre direto
// num <img>: é preciso trocar por uma signed URL temporária.

export const FOTO_BUCKET = "colaboradores-fotos";
const FOTO_SIGNED_TTL = 3600; // 1h

// Extrai o caminho do objeto no bucket a partir do valor armazenado, que pode
// estar em 2 formatos: URL pública antiga (.../colaboradores-fotos/<path>?v=) ou
// já o próprio path. Retorna null se não houver foto.
export function fotoPath(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = String(v).split("?")[0];
  const marker = "/colaboradores-fotos/";
  const i = s.indexOf(marker);
  if (i >= 0) return s.slice(i + marker.length);
  if (!/^https?:\/\//i.test(s)) return s; // já é um path
  return null;
}

// Cliente mínimo que o helper usa (evita importar o tipo do supabase-js).
type StorageClient = {
  storage: {
    from(bucket: string): {
      createSignedUrls(
        paths: string[],
        expiresIn: number,
      ): Promise<{ data: unknown; error: unknown }>;
    };
  };
};

// Assina em lote (1 chamada) os valores de foto recebidos e devolve um mapa
// valor original → signed URL. Valores vazios/nulos ou sem path reconhecível
// ficam de fora; quem chamar mantém o valor original para esses. Deve ser usado
// com cliente service role (ignora RLS do bucket). Nunca lança: em erro,
// registra no log e devolve o que conseguiu.
export async function assinarFotos(
  supabase: StorageClient,
  valores: (string | null | undefined)[],
): Promise<Map<string, string>> {
  const resultado = new Map<string, string>();
  const pathPorValor = new Map<string, string>();
  for (const v of valores) {
    if (!v || pathPorValor.has(v)) continue;
    const p = fotoPath(v);
    if (p) pathPorValor.set(v, p);
  }
  const paths = Array.from(new Set(pathPorValor.values()));
  if (paths.length === 0) return resultado;

  try {
    const { data: signed, error } = await supabase.storage
      .from(FOTO_BUCKET)
      .createSignedUrls(paths, FOTO_SIGNED_TTL);
    if (error) console.error("Erro ao assinar fotos:", error);
    const porPath = new Map<string, string>();
    for (const s of (Array.isArray(signed) ? signed : []) as Array<
      { path?: string | null; signedUrl?: string | null }
    >) {
      if (s?.path && s?.signedUrl) porPath.set(s.path, s.signedUrl);
    }
    for (const [valor, p] of pathPorValor) {
      const url = porPath.get(p);
      if (url) resultado.set(valor, url);
    }
  } catch (e) {
    console.error("Erro ao assinar fotos:", e);
  }
  return resultado;
}
