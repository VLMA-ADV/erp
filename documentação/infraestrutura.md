# Documentação de Infraestrutura - ERP-VLMA

## Índice

1. [Stack Tecnológico](#1-stack-tecnológico)
2. [Bancos de Dados](#2-bancos-de-dados)
3. [Estratégia de Branches](#3-estratégia-de-branches)
4. [Estrutura de Pastas](#4-estrutura-de-pastas)
5. [Configuração do Ambiente](#5-configuração-do-ambiente)
6. [Deploy e CI/CD](#6-deploy-e-cicd)

---

## 1. Stack Tecnológico

### 1.1. Linguagem e Framework

**Linguagem:** TypeScript

**Framework Frontend:** Next.js (App Router)

**Framework Backend:** Next.js API Routes (Full-stack)

**Justificativa:**
- TypeScript oferece type safety e melhor experiência de desenvolvimento
- Next.js permite desenvolvimento full-stack com API routes
- App Router oferece melhor performance e developer experience
- SSR/SSG nativos para melhor SEO e performance

### 1.2. Biblioteca de UI

**Biblioteca:** shadcn/ui

**Justificativa:**
- Componentes acessíveis e customizáveis
- Baseado em Radix UI (acessibilidade)
- Tailwind CSS para estilização
- Fácil customização e manutenção
- Componentes copiados para o projeto (não dependência)

### 1.3. Estilização

**Framework CSS:** Tailwind CSS

**Justificativa:**
- Utility-first CSS
- Integração nativa com shadcn/ui
- Performance otimizada
- Fácil manutenção e customização

### 1.4. Banco de Dados

**Plataforma:** Supabase

**Tipo:** PostgreSQL (gerenciado)

**ORM:** Prisma ou Supabase Client

**Justificativa:**
- PostgreSQL robusto e confiável
- Supabase oferece autenticação, storage e realtime
- Type-safe queries com TypeScript
- Migrations gerenciadas

### 1.5. Autenticação

**Solução:** Supabase Auth

**Justificativa:**
- Integração nativa com Supabase
- JWT tokens
- Gerenciamento de sessões
- Suporte a múltiplos provedores (se necessário)

### 1.6. Outras Bibliotecas Principais

- **Validação:** Zod
- **Formulários:** React Hook Form
- **Data Fetching:** TanStack Query (React Query)
- **Estado Global:** Zustand ou Context API
- **Date Handling:** date-fns
- **HTTP Client:** Axios ou fetch nativo

---

## 2. Bancos de Dados

### 2.1. Estratégia de Ambientes

Utilizaremos **dois bancos de dados separados** no Supabase:

1. **Database de Desenvolvimento (dev)**
2. **Database de Produção (prod)**

### 2.2. Database de Desenvolvimento

**Nome do Projeto Supabase:** `erp-vlma-dev`

**Propósito:**
- Desenvolvimento local e testes
- Dados de teste e desenvolvimento
- Migrations experimentais
- Testes de integração

**Características:**
- Pode ser resetado sem impacto
- Dados podem ser inconsistentes durante desenvolvimento
- Permite experimentação sem riscos
- Acesso liberado para toda equipe de desenvolvimento

**Configuração:**
- URL: `https://[project-ref].supabase.co`
- Anon Key: Disponível para desenvolvedores
- Service Role Key: Disponível apenas para admins

### 2.3. Database de Produção

**Nome do Projeto Supabase:** `erp-vlma-prod`

**Propósito:**
- Dados reais dos clientes
- Ambiente de produção
- Alta disponibilidade
- Backup automático

**Características:**
- Dados críticos e sensíveis
- Não pode ser resetado
- Migrations devem ser testadas em dev primeiro
- Acesso restrito apenas para admins e deploy automatizado

**Configuração:**
- URL: `https://[project-ref].supabase.co`
- Anon Key: Usado apenas pela aplicação em produção
- Service Role Key: Acesso extremamente restrito

### 2.4. Migrations

**Estratégia:**
1. Migrations são criadas e testadas no ambiente **dev**
2. Após validação, migrations são aplicadas em **prod**
3. Migrations devem ser versionadas no controle de versão
4. Rollback deve ser possível e testado

**Ferramentas:**
- Supabase CLI para migrations
- Prisma Migrate (se usar Prisma)
- Supabase Dashboard para visualização

### 2.5. Backup e Segurança

**Desenvolvimento:**
- Backups automáticos diários (Supabase padrão)
- Pode ser restaurado se necessário

**Produção:**
- Backups automáticos diários
- Backups manuais antes de migrations críticas
- Point-in-time recovery disponível
- Criptografia em trânsito e em repouso

### 2.6. Variáveis de Ambiente

```env
# Desenvolvimento
NEXT_PUBLIC_SUPABASE_URL=https://[dev-project-ref].supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=[dev-anon-key]
SUPABASE_SERVICE_ROLE_KEY=[dev-service-role-key]

# Produção
NEXT_PUBLIC_SUPABASE_URL=https://[prod-project-ref].supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=[prod-anon-key]
SUPABASE_SERVICE_ROLE_KEY=[prod-service-role-key]
```

---

## 3. Estratégia de Branches

### 3.1. Branch Principal

**`main`** ou **`master`**
- Branch de produção
- Sempre estável e deployável
- Protegida (não permite push direto)
- Requer Pull Request e code review
- Deploy automático para produção após merge

### 3.2. Branch de Desenvolvimento

**`develop`**
- Branch principal de desenvolvimento
- Integração de features
- Ambiente de staging (se aplicável)
- Deploy automático para ambiente de desenvolvimento

### 3.3. Branches de Feature

**Formato:** `feature/[ticket-id]-[descricao-curta]`

**Exemplos:**
- `feature/VLMA-123-criar-tela-clientes`
- `feature/VLMA-456-implementar-faturamento`
- `feature/VLMA-789-adicionar-filtros-timesheet`

**Regras:**
- Criada a partir de `develop`
- Nome descritivo e relacionado ao ticket
- Merge de volta para `develop` via Pull Request
- Deletada após merge

### 3.4. Branches de Bugfix

**Formato:** `bugfix/[ticket-id]-[descricao-curta]`

**Exemplos:**
- `bugfix/VLMA-234-corrigir-calculo-faturamento`
- `bugfix/VLMA-567-corrigir-validacao-cpf`

**Regras:**
- Criada a partir de `develop` ou `main` (se bug crítico)
- Merge de volta para branch de origem
- Deletada após merge

### 3.5. Branches de Hotfix

**Formato:** `hotfix/[ticket-id]-[descricao-curta]`

**Exemplos:**
- `hotfix/VLMA-999-correcao-critica-producao`
- `hotfix/VLMA-888-corrigir-vazamento-dados`

**Regras:**
- Criada a partir de `main` (produção)
- Correção urgente de bugs em produção
- Merge de volta para `main` e `develop`
- Deploy imediato para produção

### 3.6. Branches de Release

**Formato:** `release/[version]`

**Exemplos:**
- `release/v1.0.0`
- `release/v1.1.0`

**Regras:**
- Criada a partir de `develop`
- Preparação para release
- Correções de bugs finais
- Merge de volta para `main` e `develop`
- Tag de versão criada após merge

### 3.7. Convenções de Commit

**Formato:** `[tipo]: [descrição curta]`

**Tipos:**
- `feat`: Nova funcionalidade
- `fix`: Correção de bug
- `docs`: Documentação
- `style`: Formatação, ponto e vírgula, etc (não afeta código)
- `refactor`: Refatoração de código
- `test`: Adição ou correção de testes
- `chore`: Tarefas de build, configuração, etc
- `perf`: Melhoria de performance

**Exemplos:**
```
feat: adicionar tela de listagem de clientes
fix: corrigir cálculo de valor líquido no faturamento
docs: atualizar documentação de regras de negócio
refactor: reorganizar componentes de timesheet
test: adicionar testes para validação de CPF
chore: atualizar dependências do projeto
```

**Mensagem Completa:**
```
feat: adicionar tela de listagem de clientes

- Implementar tabela com paginação
- Adicionar filtros por segmento e grupo econômico
- Implementar busca por nome/CNPJ
- Adicionar ações de criar, editar e deletar

VLMA-123
```

### 3.8. Fluxo de Trabalho

```
1. Criar branch feature a partir de develop
2. Desenvolver e commitar seguindo convenções
3. Criar Pull Request para develop
4. Code review e aprovação
5. Merge para develop
6. Deploy automático para ambiente de desenvolvimento
7. Testes em desenvolvimento
8. Criar Pull Request de develop para main (release)
9. Code review final e aprovação
10. Merge para main
11. Deploy automático para produção
```

---

## 4. Estrutura de Pastas

### 4.1. Estrutura Raiz

```
erp-vlma/
├── .next/                    # Build do Next.js (gerado)
├── .git/                     # Controle de versão
├── .github/                  # Configurações do GitHub
│   ├── workflows/            # CI/CD workflows
│   └── PULL_REQUEST_TEMPLATE.md
├── .vscode/                  # Configurações do VS Code
├── public/                   # Arquivos estáticos
│   ├── images/
│   ├── icons/
│   └── favicon.ico
├── src/                      # Código fonte
│   ├── app/                  # Next.js App Router
│   ├── components/           # Componentes React
│   ├── lib/                  # Utilitários e configurações
│   ├── hooks/                # Custom hooks
│   ├── types/                # TypeScript types
│   ├── services/             # Serviços e APIs
│   ├── stores/               # Estado global (Zustand)
│   └── styles/               # Estilos globais
├── prisma/                   # Schema e migrations (se usar Prisma)
├── supabase/                 # Configurações Supabase
│   ├── migrations/           # Migrations SQL
│   └── config.toml
├── documentação/             # Documentação do projeto
├── tests/                    # Testes
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── .env.local                # Variáveis de ambiente local
├── .env.example              # Exemplo de variáveis de ambiente
├── .gitignore
├── .eslintrc.json
├── .prettierrc
├── next.config.js
├── package.json
├── tsconfig.json
├── tailwind.config.js
└── README.md
```

### 4.2. Estrutura do `src/app/`

```
src/app/
├── (auth)/                   # Grupo de rotas de autenticação
│   ├── login/
│   │   └── page.tsx
│   ├── recuperar-senha/
│   │   └── page.tsx
│   └── layout.tsx
├── (dashboard)/              # Grupo de rotas do dashboard
│   ├── layout.tsx            # Layout com sidebar e header
│   ├── page.tsx              # Dashboard home
│   ├── clientes/
│   │   ├── page.tsx          # Listagem
│   │   ├── novo/
│   │   │   └── page.tsx      # Criar
│   │   └── [id]/
│   │       ├── page.tsx      # Detalhes
│   │       └── editar/
│   │           └── page.tsx  # Editar
│   ├── contratos/
│   │   ├── page.tsx
│   │   ├── novo/
│   │   │   └── page.tsx
│   │   └── [id]/
│   │       ├── page.tsx
│   │       ├── editar/
│   │       │   └── page.tsx
│   │       ├── casos/
│   │       │   ├── page.tsx
│   │       │   └── novo/
│   │       │       └── page.tsx
│   │       └── timesheet-config/
│   │           └── page.tsx
│   ├── timesheets/
│   │   ├── page.tsx
│   │   ├── novo/
│   │   │   └── page.tsx
│   │   └── [id]/
│   │       ├── page.tsx
│   │       └── editar/
│   │           └── page.tsx
│   ├── faturamentos/
│   │   ├── page.tsx
│   │   ├── novo/
│   │   │   └── page.tsx
│   │   └── [id]/
│   │       ├── page.tsx
│   │       ├── editar/
│   │       │   └── page.tsx
│   │       └── revisar/
│   │           └── page.tsx
│   ├── cobrancas/
│   │   ├── page.tsx
│   │   └── [id]/
│   │       └── page.tsx
│   ├── pagamentos/
│   │   ├── page.tsx
│   │   ├── novo/
│   │   │   └── page.tsx
│   │   └── [id]/
│   │       └── page.tsx
│   ├── despesas/
│   │   ├── page.tsx
│   │   ├── novo/
│   │   │   └── page.tsx
│   │   └── [id]/
│   │       └── page.tsx
│   ├── colaboradores/
│   │   ├── page.tsx
│   │   ├── novo/
│   │   │   └── page.tsx
│   │   └── [id]/
│   │       ├── page.tsx
│   │       ├── editar/
│   │       │   └── page.tsx
│   │       └── permissoes/
│   │           └── page.tsx
│   ├── avaliacoes-pdi/
│   │   ├── page.tsx
│   │   ├── novo/
│   │   │   └── page.tsx
│   │   └── [id]/
│   │       ├── page.tsx
│   │       └── editar/
│   │           └── page.tsx
│   ├── configuracoes/
│   │   └── page.tsx
│   └── relatorios/
│       └── page.tsx
├── api/                      # API Routes
│   ├── auth/
│   │   └── callback/
│   │       └── route.ts
│   ├── clientes/
│   │   ├── route.ts          # GET, POST
│   │   └── [id]/
│   │       └── route.ts      # GET, PUT, DELETE
│   ├── contratos/
│   │   └── ...
│   └── ...
├── globals.css                # Estilos globais
├── layout.tsx                # Layout raiz
└── page.tsx                  # Página inicial (redirect)
```

### 4.3. Estrutura do `src/components/`

```
src/components/
├── ui/                       # Componentes shadcn/ui
│   ├── button.tsx
│   ├── input.tsx
│   ├── table.tsx
│   ├── dialog.tsx
│   ├── form.tsx
│   └── ...
├── layout/                   # Componentes de layout
│   ├── Sidebar.tsx
│   ├── Header.tsx
│   ├── Footer.tsx
│   └── Navigation.tsx
├── clientes/                 # Componentes específicos de clientes
│   ├── ClienteForm.tsx
│   ├── ClienteTable.tsx
│   ├── ClienteFilters.tsx
│   └── ClienteDetails.tsx
├── contratos/                # Componentes específicos de contratos
│   ├── ContratoForm.tsx
│   ├── ContratoTable.tsx
│   └── ...
├── timesheets/               # Componentes específicos de timesheets
│   ├── TimesheetForm.tsx
│   ├── TimesheetTable.tsx
│   └── ...
├── faturamentos/             # Componentes específicos de faturamentos
│   ├── FaturamentoForm.tsx
│   ├── FaturamentoTable.tsx
│   ├── FaturamentoReview.tsx
│   └── ItemFaturamentoEditor.tsx
├── shared/                   # Componentes compartilhados
│   ├── Loading.tsx
│   ├── ErrorBoundary.tsx
│   ├── EmptyState.tsx
│   └── ConfirmDialog.tsx
└── providers/                # Context providers
    ├── AuthProvider.tsx
    ├── ThemeProvider.tsx
    └── QueryProvider.tsx
```

### 4.4. Estrutura do `src/lib/`

```
src/lib/
├── supabase/
│   ├── client.ts             # Cliente Supabase
│   ├── server.ts             # Cliente Supabase server-side
│   └── types.ts              # Types gerados do Supabase
├── utils/
│   ├── cn.ts                 # Utility para className (shadcn)
│   ├── format.ts             # Formatação de dados
│   ├── validation.ts         # Validações auxiliares
│   └── constants.ts          # Constantes
├── hooks/
│   ├── use-auth.ts
│   ├── use-permissions.ts
│   └── ...
└── schemas/                  # Zod schemas
    ├── cliente.schema.ts
    ├── contrato.schema.ts
    ├── timesheet.schema.ts
    └── ...
```

### 4.5. Estrutura do `src/services/`

```
src/services/
├── api/
│   ├── clientes.service.ts
│   ├── contratos.service.ts
│   ├── timesheets.service.ts
│   ├── faturamentos.service.ts
│   └── ...
├── auth/
│   └── auth.service.ts
└── storage/
    └── storage.service.ts
```

### 4.6. Estrutura do `src/types/`

```
src/types/
├── database.types.ts         # Types do Supabase
├── cliente.types.ts
├── contrato.types.ts
├── timesheet.types.ts
├── faturamento.types.ts
└── index.ts                  # Exports centralizados
```

### 4.7. Estrutura do `src/stores/` (Zustand)

```
src/stores/
├── auth.store.ts
├── ui.store.ts
└── filters.store.ts
```

---

## 5. Configuração do Ambiente

### 5.1. Variáveis de Ambiente

**`.env.local`** (não versionado):
```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://[project-ref].supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=[anon-key]
SUPABASE_SERVICE_ROLE_KEY=[service-role-key]

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
NODE_ENV=development

# Outras
NEXT_PUBLIC_SENTRY_DSN=[sentry-dsn] (opcional)
```

**`.env.example`** (versionado):
```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
NODE_ENV=development
```

### 5.2. Configuração do Next.js

**`next.config.js`**:
```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  images: {
    domains: ['[project-ref].supabase.co'],
  },
  env: {
    CUSTOM_KEY: process.env.CUSTOM_KEY,
  },
}

module.exports = nextConfig
```

### 5.3. Configuração do TypeScript

**`tsconfig.json`**:
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "forceConsistentCasingInFileNames": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [
      {
        "name": "next"
      }
    ],
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

### 5.4. Configuração do Tailwind CSS

**`tailwind.config.js`**:
```javascript
/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: [
    './pages/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './app/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        // ... outras cores do shadcn
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
}
```

---

## 6. Deploy e CI/CD

### 6.1. Plataforma de Deploy

**Produção:** Vercel (recomendado para Next.js)

**Alternativas:**
- Netlify
- AWS Amplify
- Self-hosted (Docker)

### 6.2. Pipeline CI/CD

**GitHub Actions** (`.github/workflows/`):

**Workflow de Desenvolvimento:**
```yaml
name: Deploy to Development

on:
  push:
    branches:
      - develop

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm ci
      - run: npm run build
      - run: npm run test
      - uses: vercel/action@v20
        with:
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          vercel-org: ${{ secrets.VERCEL_ORG }}
          vercel-project: ${{ secrets.VERCEL_PROJECT_DEV }}
          vercel-args: '--prod'
```

**Workflow de Produção:**
```yaml
name: Deploy to Production

on:
  push:
    branches:
      - main

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm ci
      - run: npm run build
      - run: npm run test
      - run: npm run lint
      - uses: vercel/action@v20
        with:
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          vercel-org: ${{ secrets.VERCEL_ORG }}
          vercel-project: ${{ secrets.VERCEL_PROJECT_PROD }}
          vercel-args: '--prod'
```

### 6.3. Ambientes de Deploy

**Desenvolvimento:**
- URL: `https://erp-vlma-dev.vercel.app`
- Banco: `erp-vlma-dev` (Supabase)
- Deploy automático ao fazer push em `develop`

**Produção:**
- URL: `https://erp-vlma.com` (ou domínio customizado)
- Banco: `erp-vlma-prod` (Supabase)
- Deploy automático ao fazer push em `main`
- Requer aprovação manual (opcional)

### 6.4. Migrations em Produção

**Processo:**
1. Migration criada e testada em dev
2. Migration commitada no repositório
3. Deploy para dev valida migration
4. Após validação, migration aplicada manualmente em prod (ou via CI/CD)
5. Backup de prod antes de migration crítica

**Comando Supabase CLI:**
```bash
# Aplicar migration em dev
supabase db push --project-ref [dev-project-ref]

# Aplicar migration em prod (após validação)
supabase db push --project-ref [prod-project-ref]
```

---

## 7. Observações Finais

### 7.1. Segurança

- Nunca commitar credenciais no repositório
- Usar variáveis de ambiente para todas as configurações sensíveis
- Service Role Key apenas em ambiente server-side
- Implementar rate limiting nas APIs
- Validar e sanitizar todas as entradas

### 7.2. Performance

- Implementar cache onde apropriado
- Otimizar queries do banco de dados
- Usar Next.js Image para imagens
- Lazy loading de componentes pesados
- Code splitting automático do Next.js

### 7.3. Monitoramento

- Implementar logging estruturado
- Monitorar erros (Sentry, LogRocket, etc)
- Monitorar performance (Vercel Analytics)
- Alertas para erros críticos

### 7.4. Documentação

- Manter README.md atualizado
- Documentar APIs
- Comentários em código complexo
- Guias de contribuição

---

## Referências

- [Next.js Documentation](https://nextjs.org/docs)
- [Supabase Documentation](https://supabase.com/docs)
- [shadcn/ui Documentation](https://ui.shadcn.com)
- [Tailwind CSS Documentation](https://tailwindcss.com/docs)
- [TypeScript Documentation](https://www.typescriptlang.org/docs)
