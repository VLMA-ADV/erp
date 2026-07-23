/** @type {import('next').NextConfig} */

// CSP — connect-src cobre Supabase (REST/Functions/Realtime) e ViaCEP (busca de
// endereço no client). script/style ficam com 'unsafe-inline'/'unsafe-eval'
// porque o Next injeta bootstrap inline; endurecer com nonce exige middleware
// (fase seguinte). Vai em Report-Only primeiro para não quebrar prod — depois
// de confirmar zero violação no console, vira enforcing.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.supabase.co",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://viacep.com.br",
  "frame-ancestors 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ')

const securityHeaders = [
  // CSP em modo de RELATÓRIO — não bloqueia, só reportaria. Trocar o nome do
  // header para 'Content-Security-Policy' quando validado (zero violação).
  { key: 'Content-Security-Policy-Report-Only', value: csp },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
]

const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.supabase.co',
      },
    ],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ]
  },
  // Excluir pasta supabase do type checking durante o build
  typescript: {
    // Ignorar erros de tipo em arquivos do supabase
    ignoreBuildErrors: false,
  },
  // Excluir pasta supabase do build do Next.js
  webpack: (config) => {
    // Ignorar pasta supabase completamente durante o watch
    config.watchOptions = {
      ...config.watchOptions,
      ignored: ['**/supabase/**'],
    }

    return config
  },
}

module.exports = nextConfig
