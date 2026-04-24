# Variáveis de Ambiente

Este arquivo documenta as variáveis de ambiente necessárias para o projeto.

## Variáveis Obrigatórias

### NEXT_PUBLIC_SUPABASE_URL
URL do seu projeto Supabase.

**Exemplo:**
```
NEXT_PUBLIC_SUPABASE_URL=https://xwubxpcixxwfoduwyzmo.supabase.co
```

### NEXT_PUBLIC_SUPABASE_ANON_KEY
Chave pública (anon) do Supabase. Esta chave é segura para expor no cliente.

**Exemplo:**
```
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

## Variáveis Opcionais

### SUPABASE_SERVICE_ROLE_KEY
Chave de service role do Supabase. **NUNCA** exponha esta chave no cliente.
Esta chave só deve ser usada em Edge Functions do Supabase, não no frontend.

## Configuração no Netlify

1. Acesse o painel do Netlify
2. Vá em **Site settings** > **Environment variables**
3. Adicione as variáveis acima
4. Certifique-se de que as variáveis `NEXT_PUBLIC_*` estão marcadas como "Available during build"

## Configuração Local

Crie um arquivo `.env.local` na raiz do projeto com as variáveis:

```env
NEXT_PUBLIC_SUPABASE_URL=https://xwubxpcixxwfoduwyzmo.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sua_chave_aqui
```

**Importante:** O arquivo `.env.local` não deve ser commitado no Git (já está no `.gitignore`).
