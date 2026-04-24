import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      'Missing Supabase environment variables. Please check NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are set.'
    )
  }

  return createBrowserClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return document.cookie.split(';').map(cookie => {
          const [name, ...rest] = cookie.trim().split('=')
          return {
            name: decodeURIComponent(name),
            value: decodeURIComponent(rest.join('=')),
          }
        })
      },
      setAll(cookiesToSet: Array<{ name: string; value: string; options?: any }>) {
        cookiesToSet.forEach(({ name, value, options }) => {
          if (options?.httpOnly) {
            // httpOnly cookies não podem ser definidos via JavaScript
            return
          }
          
          let cookieString = `${encodeURIComponent(name)}=${encodeURIComponent(value)}`
          
          if (options?.maxAge) {
            cookieString += `; Max-Age=${options.maxAge}`
          }
          if (options?.expires) {
            cookieString += `; Expires=${options.expires.toUTCString()}`
          }
          if (options?.domain) {
            cookieString += `; Domain=${options.domain}`
          }
          if (options?.path) {
            cookieString += `; Path=${options.path}`
          } else {
            cookieString += `; Path=/`
          }
          if (options?.secure) {
            cookieString += `; Secure`
          }
          if (options?.sameSite) {
            cookieString += `; SameSite=${options.sameSite}`
          }
          
          document.cookie = cookieString
        })
      },
    },
  })
}
