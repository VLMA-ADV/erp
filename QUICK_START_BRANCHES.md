# 🚀 Guia Rápido: Configurar Branches

## Executar Agora

### Opção 1: Usando o Script (Recomendado)

```bash
./scripts/setup-branches.sh
```

### Opção 2: Manualmente

```bash
# 1. Garantir que está na main e atualizado
git checkout main
git pull origin main

# 2. Criar branch dev
git checkout -b dev

# 3. Enviar para o GitHub
git push -u origin dev
```

## Próximos Passos no GitHub

### 1. Configurar Proteções de Branch

Acesse: https://github.com/VLMA-ADV/erp/settings/branches

**Para `main`:**
- Adicione regra de proteção
- ✅ Require a pull request before merging
- ✅ Require approvals (1)
- ✅ Require status checks to pass
- ✅ Do not allow bypassing

**Para `dev`:**
- Adicione regra de proteção
- ✅ Require status checks to pass

### 2. Configurar Secrets

Acesse: https://github.com/VLMA-ADV/erp/settings/secrets/actions

Adicione:
- `NETLIFY_AUTH_TOKEN_DEV`
- `NETLIFY_SITE_ID_DEV`
- `NETLIFY_AUTH_TOKEN_PROD`
- `NETLIFY_SITE_ID_PROD`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

### 3. Configurar Netlify

1. Crie 2 sites no Netlify:
   - **Dev**: Conectado à branch `dev`
   - **Prod**: Conectado à branch `main`

2. Configure variáveis de ambiente em cada site

## Workflow

```
feature/* → dev → main
```

- Desenvolvimento em `dev`
- Features em `feature/*`
- Produção em `main`

## Mais Informações

Consulte `README_BRANCHES.md` para documentação completa.
