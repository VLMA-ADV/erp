# Drift Report — Design System Stripe-inspired (PR #116)

**Data:** 2026-05-22
**Branch:** `redesign/stripe-tokens-vlma`
**Commits:** `0f5719b` (tokens base) + `3d3a566` (palette ampliado)
**Metodologia:** [/polish — pbakaus/impeccable](https://github.com/pbakaus/impeccable) "Identify drift, then name the root cause" + varredura paralela com 3 sub-agentes.

---

## Sumário executivo

| Categoria | Escaneados | Com drift | Conformidade |
|---|---|---|---|
| Pages do dashboard (`app/(dashboard)/**/page.tsx`) | 42 | 37 | **12%** |
| Componentes de módulo (`components/<mod>/**`, excl. `ui/`) | 108 | 48 | **56%** |
| Layouts / auth / shadcn primitives restantes | 25 | ~12 | **52%** |
| **Total agregado** | **175** | **~97** | **~45%** |

Os 3 pilotos já corrigidos no PR #116 (`/home`, `/pessoas/clientes` header, `/contratos` header) estão limpos.

---

## Top 5 padrões de drift (consolidado)

| # | Padrão | Ocorrências aprox. | Fix mecânico |
|---|---|---|---|
| 1 | `text-3xl/2xl font-bold` em headings | ~55 | `display-lg/md text-ink` |
| 2 | `text-gray-500/600/700` ou `text-slate-*` | ~60 | `text-ink-mute` / `text-ink-secondary` |
| 3 | `py-10` (sem `px-6`) em container de page | ~37 | `px-6 py-12` |
| 4 | `bg-red-50 text-red-800` em divs (alerts roll-your-own) | ~26 | `<Alert>` com tokens destructive |
| 5 | `bg-gray-50` / `bg-slate-50/100` | ~15 | `bg-canvas-soft` |

Padrão é **muito repetitivo**, o que viabiliza fix em batch.

---

## Risco crítico — afeta TODAS as telas

Estes arquivos do "shell" do app têm drift que aparece em qualquer rota visitada. Fix aqui dá maior ROI visual:

### 1. Sidebar + Layout do dashboard
- `src/app/(dashboard)/layout.tsx` — L14: `bg-gray-50`, L16: `bg-gray-200`, L57: `bg-white/95`
- `src/components/layout/sidebar.tsx` — L91: `bg-gray-50`, L93: `text-xl font-bold text-gray-900`
- `src/components/layout/sidebar-client.tsx` — L102: `text-xl font-bold text-gray-900`, L103: `text-sm text-gray-500`
- `src/components/layout/sidebar-item.tsx` — L20: `text-gray-700 hover:bg-gray-100`
- `src/components/ui/sidebar.tsx` (shadcn) — L5: `bg-gray-50`, sem `border-hairline`

### 2. Auth pages
- `src/app/login/page.tsx` — `bg-gray-50`, heading `text-3xl font-bold tracking-tight text-gray-900`, descrição `text-gray-600`
- `src/app/recuperar-senha/page.tsx` — idem
- `src/app/redefinir-senha/page.tsx` — idem
- `src/components/auth/login-form.tsx` — L91-92: alert hardcoded `rounded-md bg-red-50 p-4 / text-red-800`
- `src/components/auth/reset-password-form.tsx` — L182-183, 226-227: mesmo padrão

### 3. Shadcn primitives restantes
- `src/components/ui/tabs.tsx` — L52: `bg-gray-100 text-gray-500`, L84-85: `text-gray-950 / bg-white text-gray-950`
- `src/components/ui/tooltip.tsx` — L39: `bg-gray-900 text-white`, L23/25: `border-gray-900`
- `src/components/ui/dialog.tsx` — L110: `text-lg font-semibold` em DialogTitle, L121: `text-sm text-gray-500` em DialogDescription
- `src/components/ui/dropdown-menu.tsx` — L26: `hover:bg-muted` solto, sem `border-hairline`
- `src/components/ui/popover.tsx` — L28: `bg-white rounded-md border shadow` sem token
- `src/components/ui/sonner.tsx` — L37-43: `green-50`, `red-50`, `gray-200` hardcoded em toast styling
- `src/components/ui/password-input.tsx` — L26: `text-gray-500 hover:text-gray-700`
- `src/components/ui/breadcrumb.tsx` — L11: `text-muted-foreground` (aceita; menor prioridade)
- `src/components/ui/alert.tsx` — sem `border-hairline` explícito

---

## Pages do dashboard — drift uniforme (37 arquivos)

O padrão é quase 100% idêntico em todas:

```tsx
// ANTES (drift uniforme)
<div className="container mx-auto py-10">
  <div className="mb-6">
    <h1 className="text-3xl font-bold">Título</h1>
    <p className="mt-2 text-gray-600">Descrição</p>
  </div>
  ...

// DEPOIS (alinhado ao design system)
<div className="container mx-auto px-6 py-12">
  <header className="mb-8">
    <span className="text-eyebrow">CATEGORIA</span>
    <h1 className="mt-2 display-lg text-ink">Título</h1>
    <p className="mt-2 text-sm text-ink-mute">Descrição</p>
  </header>
  ...
```

### Lista completa (37 páginas)

#### Configuração (11)
- `configuracao/areas/page.tsx`
- `configuracao/cargos/page.tsx`
- `configuracao/usuarios/page.tsx`
- `configuracao/permissoes/page.tsx`
- `configuracao/roles/page.tsx`
- `configuracao/salario-minimo/page.tsx`
- `configuracao/grupos-economicos/page.tsx`
- `configuracao/segmentos-economicos/page.tsx`
- `configuracao/categorias-prestadores-parceiros/page.tsx`
- `configuracao/servicos-produtos/page.tsx`
- `configuracao/servicos/page.tsx`

#### Pessoas — forms e edits (12)
- `pessoas/clientes/page.tsx` (só padding)
- `pessoas/clientes/novo/page.tsx`
- `pessoas/clientes/[id]/editar/page.tsx`
- `pessoas/colaboradores/novo/page.tsx`
- `pessoas/colaboradores/[id]/editar/page.tsx`
- `pessoas/colaboradores/[id]/page.tsx`
- `pessoas/colaboradores/[id]/pdi/page.tsx`
- `pessoas/fornecedores/novo/page.tsx`
- `pessoas/fornecedores/[id]/editar/page.tsx`
- `pessoas/parceiros/novo/page.tsx`
- `pessoas/parceiros/[id]/editar/page.tsx`
- `pessoas/prestadores/novo/page.tsx`
- `pessoas/prestadores/[id]/editar/page.tsx`

#### Contratos forms (4)
- `contratos/novo/page.tsx`
- `contratos/[id]/editar/page.tsx`
- `contratos/[id]/casos/novo/page.tsx`
- `contratos/[id]/casos/[casoId]/editar/page.tsx`

#### Dashboards/listas top-level (4)
- `crm/page.tsx`
- `despesas/page.tsx`
- `relatorios/page.tsx`
- `timesheet/page.tsx`

#### Financeiro (4)
- `financeiro/fluxo-de-faturamento/page.tsx`
- `financeiro/itens-a-faturar/page.tsx`
- `financeiro/notas-geradas/page.tsx`
- `financeiro/revisao-de-fatura/page.tsx`

#### Outros (2)
- `solicitacoes-contrato/page.tsx`
- `avaliacoes-pdi/page.tsx`

---

## Componentes de módulo — top 10 por densidade de drift

| Ranking | Arquivo | Drifts |
|---|---|---|
| 1 | `components/faturamento/revisao-de-fatura-list.tsx` | 12 |
| 2 | `components/contratos/nfse-preview-dialog.tsx` | 9 |
| 3 | `components/contratos/contratos-dashboard.tsx` | 8 |
| 4 | `components/crm/crm-pipeline.tsx` | 6 |
| 5 | `components/layout/sidebar.tsx` | 5 |
| 6 | `components/colaboradores/colaborador-view.tsx` | 5 |
| 7 | `components/solicitacoes-contrato/solicitacoes-contrato-list.tsx` | 4 |
| 8 | `components/clientes/clientes-list.tsx` | 4 |
| 9 | `components/timesheet/timesheet-list.tsx` | 3 |
| 10 | `components/faturamento/itens-a-faturar-list.tsx` | 3 |

### Padrões mais frequentes nos componentes
- **Alerts roll-your-own** (`rounded-md bg-red-50 p-4 / text-red-800`) em vez de `<Alert>` — ~26 arquivos
- **Slate em vez de ink** (`text-slate-*`, `bg-slate-*`, `border-slate-*`) em inboxes (`contratos/`, `crm/`, `solicitacoes/`) — ~14 arquivos
- **Botões coloridos roll-your-own** (`bg-amber-600`, `bg-green-700`, `bg-blue-500`) em vez de `<Button>` — ~8 arquivos
- **Headings 3xl/2xl font-bold** em page-clients e modais — ~10 arquivos
- **Money cells sem `.font-tabular`** especialmente em `faturamento/`, `timesheet/`, `casos/` — não auditado por linha mas crítico para legibilidade financeira

### Status badges (verde/vermelho) — decisão semântica
Padrão `bg-green-100 text-green-800` (ativo) / `bg-red-100 text-red-800` (inativo) em `clientes-table.tsx`, `prestadores-table.tsx`, `parceiros-table.tsx`, `colaborador-view.tsx`: **semanticamente aceitável**. Migração para `<Badge variant="soft">` é melhoria de consistência, não correção de bug.

---

## Estratégia de fix proposta (em waves)

### Wave 1 — Shell do app (alto impacto, baixo esforço)
~10 arquivos. Afeta 100% das telas via cascata visual.
- Sidebar (3 arquivos) + layout dashboard
- 3 auth pages + 2 auth forms
- Shadcn primitives críticos: `tabs.tsx`, `tooltip.tsx`, `dialog.tsx` (DialogTitle/Description), `dropdown-menu.tsx`, `sonner.tsx`, `password-input.tsx`

**Estimativa:** 30-45 min. Risco baixo (mudança só de tokens; estrutura preservada).

### Wave 2 — Pages do dashboard (batch mecânico)
36 arquivos. Substituição quase idêntica em todos.
- Replace `text-3xl font-bold` → `display-lg text-ink`
- Replace `text-gray-600` → `text-ink-mute`
- Replace `py-10` (sem `px-6`) → `px-6 py-12`
- Adicionar eyebrow `<span className="text-eyebrow">CATEGORIA</span>` (categoria por módulo)

**Estimativa:** 1.5-2h. Risco médio (eyebrow text precisa contexto por página). Posso usar replace mecânico nos 3 primeiros itens e revisar manualmente os eyebrows.

### Wave 3 — Componentes de alta densidade (manual)
Top 10 da tabela acima — cada um requer revisão por arquivo.
- Priorizar `revisao-de-fatura-list.tsx`, `nfse-preview-dialog.tsx`, `contratos-dashboard.tsx`, `crm-pipeline.tsx`

**Estimativa:** 2-3h. Risco médio-alto (lógica de UI complexa; smoke por arquivo).

### Wave 4 — Money cells (`.font-tabular`)
Específico para `faturamento/`, `timesheet/`, `casos/`. Adicionar `font-tabular` em qualquer `<td>` ou span que renderize `R$`, `%`, contagem.

**Estimativa:** 1h. Risco baixo (aditivo, não substitui nada).

### Wave 5 — Cleanup geral (resto dos componentes)
Restante dos ~38 componentes com 1-2 drifts cada (page-clients de pessoas, configuracao/role-modal etc.).

**Estimativa:** 1.5-2h. Risco baixo.

### Wave 6 (opcional) — Status badges canonical
Migrar verde/vermelho hardcoded para `<Badge variant="soft">` com tokens. Melhoria de consistência, não correção.

**Estimativa:** 1h. Risco baixo.

---

## Total estimado

| Wave | Esforço | ROI visual | Risco |
|---|---|---|---|
| 1 — Shell | 30-45min | ★★★★★ | baixo |
| 2 — Dashboard pages | 1.5-2h | ★★★★ | médio |
| 3 — Componentes densos | 2-3h | ★★★★ | médio-alto |
| 4 — Money cells | 1h | ★★★ | baixo |
| 5 — Cleanup | 1.5-2h | ★★ | baixo |
| 6 — Status badges | 1h | ★ | baixo |
| **Total** | **7.5-10h** | | |

---

## Recomendação

Atacar nessa ordem. Wave 1 sozinha já desloca a percepção visual do app para 80% Stripe sem mudar regra de negócio. Waves 2-3 fecham a consistência. Wave 4 trata o ponto fraco específico (tabelas financeiras). Wave 5-6 são polimento opcional.

**Próximo passo aguardando aprovação:** quais waves aplicar e em que ordem.
