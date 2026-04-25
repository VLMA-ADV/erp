/**
 * fetch com retry exponencial + jitter. Respeita AbortSignal — não faz retry
 * quando o caller cancela (DOMException name='AbortError'). Retry só dispara
 * em erro de rede (TypeError 'Failed to fetch', ERR_CONNECTION_CLOSED) e em
 * respostas 5xx; 4xx propaga sem retry (erro do caller).
 *
 * Uso típico:
 *   const ac = new AbortController()
 *   useEffect(() => () => ac.abort(), [])
 *   const resp = await fetchWithRetry(url, { headers, signal: ac.signal })
 */
export interface FetchRetryOptions extends RequestInit {
  retries?: number
  backoffMs?: number
}

export async function fetchWithRetry(
  input: RequestInfo | URL,
  init: FetchRetryOptions = {},
): Promise<Response> {
  const { retries = 2, backoffMs = 300, signal, ...rest } = init
  let lastErr: unknown

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError')
    }

    try {
      const resp = await fetch(input, { ...rest, signal })
      // 5xx: retry; 4xx e 2xx/3xx: propagar
      if (resp.status >= 500 && resp.status < 600 && attempt < retries) {
        lastErr = new Error(`HTTP ${resp.status}`)
        await sleep(jitteredBackoff(backoffMs, attempt), signal)
        continue
      }
      return resp
    } catch (err) {
      // Caller cancelou: propagar imediatamente
      if (err instanceof DOMException && err.name === 'AbortError') throw err
      lastErr = err
      if (attempt < retries) {
        await sleep(jitteredBackoff(backoffMs, attempt), signal)
        continue
      }
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error('fetchWithRetry failed')
}

function jitteredBackoff(baseMs: number, attempt: number): number {
  return baseMs * Math.pow(2, attempt) + Math.random() * 100
}

function sleep(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(t)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
