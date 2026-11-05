import { createClient } from '@supabase/supabase-js'

// Só para rotas de servidor, depois de validar o usuário: esta chave passa por
// cima de todas as permissões do banco. Nunca importar em componente de cliente.
export function createClienteServico() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !chave) return null
  return createClient(url, chave, { auth: { persistSession: false } })
}
