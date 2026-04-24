# Troubleshooting - Erro no Netlify

## Erro: "Application error: a server-side exception has occurred"

Este erro geralmente ocorre quando há problemas com:

### 1. Variáveis de Ambiente Não Configuradas

**Sintoma:** Erro de runtime no Netlify

**Solução:**
1. Acesse o painel do Netlify
2. Vá em **Site settings** > **Environment variables**
3. Certifique-se de que as seguintes variáveis estão configuradas:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`

4. **Importante:** As variáveis devem estar marcadas como "Available during build"

### 2. Verificar Logs do Netlify

1. Acesse o painel do Netlify
2. Vá em **Functions** > **Logs** ou **Deploys** > **Latest deploy** > **Functions log**
3. Procure por erros específicos relacionados a:
   - Variáveis de ambiente ausentes
   - Erros de conexão com Supabase
   - Erros de importação de módulos

### 3. Verificar Build Logs

1. Acesse **Deploys** > **Latest deploy**
2. Verifique se o build foi bem-sucedido
3. Procure por warnings ou erros durante o build

### 4. Problemas Comuns

#### Variáveis de Ambiente com Valores Incorretos
- Certifique-se de que `NEXT_PUBLIC_SUPABASE_URL` está no formato: `https://xxxxx.supabase.co`
- Certifique-se de que `NEXT_PUBLIC_SUPABASE_ANON_KEY` é a chave anon (não a service role key)

#### Problemas com Cookies
- O Netlify pode ter problemas com cookies em algumas configurações
- Verifique se o domínio está configurado corretamente

#### Problemas com Next.js Runtime
- Certifique-se de que o plugin `@netlify/plugin-nextjs` está instalado
- Verifique se a versão do Node.js está correta (20)

### 5. Solução Rápida

Se o erro persistir, tente:

1. **Limpar cache do Netlify:**
   - Vá em **Deploys** > **Trigger deploy** > **Clear cache and deploy site**

2. **Reverter para deploy anterior:**
   - Vá em **Deploys** > Selecione um deploy anterior > **Publish deploy**

3. **Verificar configuração do netlify.toml:**
   - Certifique-se de que o arquivo está correto
   - Verifique se o `publish` está configurado como `.next`

### 6. Debug Adicional

Adicione logs temporários para debug:

```typescript
// Em src/lib/supabase/server.ts
export async function createClient() {
  console.log('NEXT_PUBLIC_SUPABASE_URL:', process.env.NEXT_PUBLIC_SUPABASE_URL ? 'Set' : 'Missing')
  console.log('NEXT_PUBLIC_SUPABASE_ANON_KEY:', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? 'Set' : 'Missing')
  
  // ... resto do código
}
```

**Importante:** Remova os logs após o debug para não expor informações sensíveis.

### 7. Contato

Se o problema persistir:
1. Verifique os logs completos do Netlify
2. Verifique a documentação do Netlify para Next.js
3. Verifique a documentação do Supabase SSR
