# Deploy na Netlify

Este guia explica como fazer o deploy do ERP-VLMA na Netlify.

## Pré-requisitos

1. Conta na Netlify (https://www.netlify.com/)
2. Repositório Git (GitHub, GitLab ou Bitbucket)
3. Projeto Supabase configurado

## Passo a Passo

### 1. Preparar o Repositório

Certifique-se de que todos os arquivos estão commitados e enviados para o repositório:

```bash
git add .
git commit -m "Preparar para deploy na Netlify"
git push
```

### 2. Instalar Plugin do Next.js (Opcional)

O arquivo `netlify.toml` já está configurado para usar o plugin `@netlify/plugin-nextjs`. 
Se preferir, você pode instalar localmente:

```bash
npm install --save-dev @netlify/plugin-nextjs
```

### 3. Configurar no Netlify

#### Opção A: Via Interface Web

1. Acesse https://app.netlify.com/
2. Clique em "Add new site" > "Import an existing project"
3. Conecte seu repositório Git
4. Configure as seguintes opções:
   - **Build command:** `npm run build`
   - **Publish directory:** `.next`
   - **Node version:** `20` (ou a versão que você está usando)

#### Opção B: Via Netlify CLI

1. Instale o Netlify CLI:
```bash
npm install -g netlify-cli
```

2. Faça login:
```bash
netlify login
```

3. Inicialize o site:
```bash
netlify init
```

4. Siga as instruções para conectar ao repositório

### 4. Configurar Variáveis de Ambiente

No painel do Netlify, vá em:
**Site settings** > **Environment variables**

Adicione as seguintes variáveis:

```
NEXT_PUBLIC_SUPABASE_URL=https://xwubxpcixxwfoduwyzmo.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sua_chave_anon_aqui
```

**Importante:** 
- As variáveis que começam com `NEXT_PUBLIC_` são expostas ao cliente
- Não adicione `SUPABASE_SERVICE_ROLE_KEY` aqui, pois é sensível e só deve ser usada em Edge Functions

### 5. Configurar Build Settings

O arquivo `netlify.toml` já está configurado, mas você pode verificar no painel:

- **Build command:** `npm run build`
- **Publish directory:** `.next`
- **Node version:** `20`

### 6. Deploy

#### Via Interface:
- O deploy será automático após cada push no branch principal
- Você também pode fazer deploy manual clicando em "Trigger deploy"

#### Via CLI:
```bash
netlify deploy --prod
```

## Configurações Adicionais

### Domínio Customizado

1. Vá em **Site settings** > **Domain management**
2. Clique em "Add custom domain"
3. Siga as instruções para configurar o DNS

### Headers de Segurança

Os headers de segurança já estão configurados no `netlify.toml`:
- X-Frame-Options
- X-Content-Type-Options
- X-XSS-Protection
- Referrer-Policy
- Permissions-Policy

### Cache

O cache para assets estáticos e imagens está configurado automaticamente.

## Troubleshooting

### Erro: "Plugin @netlify/plugin-nextjs not found"

Instale o plugin localmente:
```bash
npm install --save-dev @netlify/plugin-nextjs
```

Ou adicione no `package.json`:
```json
{
  "devDependencies": {
    "@netlify/plugin-nextjs": "^4.0.0"
  }
}
```

### Erro: "Build failed"

1. Verifique os logs de build no painel do Netlify
2. Certifique-se de que todas as variáveis de ambiente estão configuradas
3. Verifique se a versão do Node está correta (20)

### Erro: "404 Not Found" nas rotas

Isso é normal para Next.js. O plugin `@netlify/plugin-nextjs` deve resolver isso automaticamente.
Se persistir, verifique se o plugin está instalado e configurado corretamente.

## Suporte

Para mais informações, consulte:
- [Documentação do Netlify](https://docs.netlify.com/)
- [Plugin Next.js para Netlify](https://github.com/netlify/netlify-plugin-nextjs)
