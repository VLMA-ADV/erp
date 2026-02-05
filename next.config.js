/** @type {import('next').NextConfig} */
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
    
    // Adicionar regra para ignorar arquivos do supabase
    // Retorna um módulo vazio para arquivos do supabase
    config.module.rules.push({
      test: /supabase\/.*\.ts$/,
      use: {
        loader: require.resolve('./webpack-null-loader.js'),
      },
    })
    
    return config
  },
}

module.exports = nextConfig
