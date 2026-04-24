# Estrutura de Branches

Este projeto utiliza uma estratégia de branching com duas branches principais:

- **`main`**: Branch de produção (deploy automático para produção)
- **`dev`**: Branch de desenvolvimento (deploy automático para ambiente de desenvolvimento)

## Estrutura

```
main (produção)
  ↑
  └── dev (desenvolvimento)
       ↑
       └── feature/* (features individuais)
```

## Workflow

### 1. Desenvolvimento

Todo o desenvolvimento acontece na branch `dev`:

```bash
# Criar e mudar para branch dev
git checkout -b dev
git push -u origin dev

# Ou se já existe, apenas mudar
git checkout dev
git pull origin dev
```

### 2. Criar Features

Para novas funcionalidades, crie branches a partir de `dev`:

```bash
# Criar branch de feature
git checkout dev
git pull origin dev
git checkout -b feature/nome-da-feature

# Trabalhar na feature...
git add .
git commit -m "feat: adiciona nova funcionalidade"

# Enviar para o repositório
git push -u origin feature/nome-da-feature
```

### 3. Merge para Dev

Após concluir a feature, faça merge para `dev`:

```bash
# Via Pull Request no GitHub (recomendado)
# Ou via linha de comando:

git checkout dev
git pull origin dev
git merge feature/nome-da-feature
git push origin dev
```

### 4. Deploy para Produção

Quando `dev` estiver estável, faça merge para `main`:

```bash
# Via Pull Request no GitHub (recomendado)
# Ou via linha de comando:

git checkout main
git pull origin main
git merge dev
git push origin main
```

## Configuração Inicial

### Passo 1: Criar branch dev

```bash
# Garantir que está na main e atualizado
git checkout main
git pull origin main

# Criar branch dev a partir da main
git checkout -b dev

# Enviar para o GitHub
git push -u origin dev
```

### Passo 2: Configurar Proteções de Branch no GitHub

1. Acesse: `https://github.com/VLMA-ADV/erp/settings/branches`

2. **Para branch `main` (produção):**
   - Adicione regra de proteção
   - Marque: "Require a pull request before merging"
   - Marque: "Require approvals" (mínimo 1 aprovação)
   - Marque: "Require status checks to pass before merging"
   - Marque: "Require branches to be up to date before merging"
   - Marque: "Do not allow bypassing the above settings"

3. **Para branch `dev` (desenvolvimento):**
   - Adicione regra de proteção
   - Marque: "Require a pull request before merging" (opcional, mas recomendado)
   - Marque: "Require status checks to pass before merging"

### Passo 3: Configurar Secrets no GitHub

1. Acesse: `https://github.com/VLMA-ADV/erp/settings/secrets/actions`

2. Adicione os seguintes secrets:

   **Para Dev:**
   - `NETLIFY_AUTH_TOKEN_DEV`
   - `NETLIFY_SITE_ID_DEV`

   **Para Production:**
   - `NETLIFY_AUTH_TOKEN_PROD`
   - `NETLIFY_SITE_ID_PROD`

   **Compartilhados:**
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`

### Passo 4: Configurar Sites no Netlify

1. Crie dois sites no Netlify:
   - **Site Dev**: Conectado à branch `dev`
   - **Site Prod**: Conectado à branch `main`

2. Configure as variáveis de ambiente em cada site:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## Convenções de Commits

Seguimos o padrão [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: adiciona nova funcionalidade
fix: corrige bug
docs: atualiza documentação
style: formatação de código
refactor: refatoração
test: adiciona testes
chore: tarefas de manutenção
```

## Scripts Úteis

### Ver branches locais e remotas
```bash
git branch -a
```

### Ver diferenças entre branches
```bash
git diff main..dev
```

### Sincronizar branch local com remota
```bash
git fetch origin
git checkout dev
git pull origin dev
```

### Deletar branch local
```bash
git branch -d feature/nome-da-feature
```

### Deletar branch remota
```bash
git push origin --delete feature/nome-da-feature
```

## CI/CD

O projeto utiliza GitHub Actions para CI/CD:

- **Push em `dev`**: Deploy automático para ambiente de desenvolvimento
- **Push em `main`**: Deploy automático para produção
- **Pull Requests**: Executa linter e build para validação

## Troubleshooting

### Erro: "branch is protected"
- Você precisa criar um Pull Request para fazer merge em branches protegidas
- Certifique-se de que todos os checks passaram

### Erro: "status checks must pass"
- Verifique os logs do GitHub Actions
- Certifique-se de que o build está passando

### Branch desatualizada
```bash
git checkout dev
git pull origin dev
git checkout feature/sua-feature
git merge dev
```
