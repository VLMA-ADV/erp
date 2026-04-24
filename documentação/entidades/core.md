# Schema `core`

## Objetivo

Concentrar tudo que é **estrutural e transversal** ao sistema: multi-tenant, RBAC, auditoria e configurações globais.

---

## 1. Tenants

**Tabela**: `core.tenants`

Representa as empresas/unidades que utilizam o ERP.

**Campos**:
- `id` (UUID, PK) - Identificador único
- `nome` (VARCHAR, NOT NULL) - Nome da empresa/unidade
- `ativo` (BOOLEAN, DEFAULT true) - Indica se está ativo
- `created_at` (TIMESTAMPTZ) - Data de criação
- `updated_at` (TIMESTAMPTZ) - Data de atualização

**Regras de Negócio**:
- Nome deve ser único
- Apenas tenants ativos podem ser utilizados

**Índices**:
- `idx_tenants_nome` (nome)
- `idx_tenants_ativo` (ativo)

---

## 2. Usuários por Tenant

**Tabela**: `core.tenant_users`

Relaciona usuários autenticados (`auth.users`) aos tenants.

**Campos**:
- `id` (UUID, PK) - Identificador único
- `tenant_id` (UUID, FK -> core.tenants.id, NOT NULL) - Tenant
- `user_id` (UUID, FK -> auth.users.id, NOT NULL) - Usuário autenticado
- `status` (ENUM, NOT NULL) - Status: ativo, suspenso
- `created_at` (TIMESTAMPTZ) - Data de criação
- `updated_at` (TIMESTAMPTZ) - Data de atualização

**Regras de Negócio**:
- Um usuário pode pertencer a múltiplos tenants
- Status determina se o usuário pode acessar o tenant
- Combinação tenant_id + user_id deve ser única

**Índices**:
- `idx_tenant_users_tenant` (tenant_id)
- `idx_tenant_users_user` (user_id)
- `idx_tenant_users_unique` (tenant_id, user_id) UNIQUE

---

## 3. RBAC — Controle de Acesso

O sistema utiliza **RBAC (Role-Based Access Control)** para gerenciar permissões.

### 3.1. Roles

**Tabela**: `core.roles`

Roles disponíveis no sistema.

**Campos**:
- `id` (UUID, PK) - Identificador único
- `tenant_id` (UUID, FK -> core.tenants.id, NOT NULL) - Tenant
- `nome` (VARCHAR, NOT NULL) - Nome da role (socio, advogado, administrativo, estagiario)
- `descricao` (TEXT) - Descrição da role
- `ativo` (BOOLEAN, DEFAULT true) - Indica se está ativa
- `created_at` (TIMESTAMPTZ) - Data de criação
- `updated_at` (TIMESTAMPTZ) - Data de atualização

**Regras de Negócio**:
- Roles possíveis: Sócio, Advogado, Administrativo, Estagiário
- Nome deve ser único por tenant
- Roles são específicas por tenant

**Índices**:
- `idx_roles_tenant` (tenant_id)
- `idx_roles_nome` (tenant_id, nome) UNIQUE

### 3.2. Permissions

**Tabela**: `core.permissions`

As permissões são definidas por **chaves semânticas**.

**Campos**:
- `id` (UUID, PK) - Identificador único
- `tenant_id` (UUID, FK -> core.tenants.id, NOT NULL) - Tenant
- `chave` (VARCHAR, NOT NULL) - Chave da permissão (ex: `contracts.contrato.read`, `operations.timesheet.write`)
- `descricao` (TEXT) - Descrição da permissão
- `categoria` (VARCHAR) - Categoria (contracts, operations, finance, etc.)
- `created_at` (TIMESTAMPTZ) - Data de criação

**Exemplos de Permissões**:
- `contracts.contrato.read` - Ler contratos
- `contracts.contrato.write` - Criar/editar contratos
- `contracts.contrato.delete` - Deletar contratos
- `operations.timesheet.read` - Ler timesheets
- `operations.timesheet.write` - Criar/editar timesheets
- `finance.faturamento.approve` - Aprovar faturamentos
- `finance.faturamento.review` - Revisar faturamentos

**Regras de Negócio**:
- Chave deve ser única por tenant
- Formato recomendado: `schema.entidade.acao`

**Índices**:
- `idx_permissions_tenant` (tenant_id)
- `idx_permissions_chave` (tenant_id, chave) UNIQUE
- `idx_permissions_categoria` (categoria)

### 3.3. Associação Role-Permission

**Tabela**: `core.role_permissions`

Associa permissões a roles.

**Campos**:
- `id` (UUID, PK) - Identificador único
- `role_id` (UUID, FK -> core.roles.id, NOT NULL) - Role
- `permission_id` (UUID, FK -> core.permissions.id, NOT NULL) - Permissão
- `created_at` (TIMESTAMPTZ) - Data de criação

**Regras de Negócio**:
- Combinação role_id + permission_id deve ser única
- Permissões podem ser atribuídas a múltiplas roles

**Índices**:
- `idx_role_permissions_role` (role_id)
- `idx_role_permissions_permission` (permission_id)
- `idx_role_permissions_unique` (role_id, permission_id) UNIQUE

### 3.4. Associação User-Role

**Tabela**: `core.user_roles`

Atribui roles a usuários.

**Campos**:
- `id` (UUID, PK) - Identificador único
- `tenant_id` (UUID, FK -> core.tenants.id, NOT NULL) - Tenant
- `user_id` (UUID, FK -> auth.users.id, NOT NULL) - Usuário
- `role_id` (UUID, FK -> core.roles.id, NOT NULL) - Role
- `created_at` (TIMESTAMPTZ) - Data de criação
- `created_by` (UUID, FK -> auth.users.id) - Usuário que atribuiu

**Regras de Negócio**:
- Um usuário pode ter múltiplas roles no mesmo tenant
- Combinação tenant_id + user_id + role_id deve ser única
- Roles são específicas por tenant

**Índices**:
- `idx_user_roles_tenant_user` (tenant_id, user_id)
- `idx_user_roles_role` (role_id)
- `idx_user_roles_unique` (tenant_id, user_id, role_id) UNIQUE

> **Nota**: A UI pode usar essas permissões para montar menus, mas a **segurança real** é garantida via RLS no banco.

---

## 4. Auditoria

**Tabela**: `core.audit_logs`

Registra alterações relevantes do sistema para rastreabilidade e auditoria.

**Campos**:
- `id` (UUID, PK) - Identificador único
- `tenant_id` (UUID, FK -> core.tenants.id, NOT NULL) - Tenant
- `tipo_entidade` (VARCHAR, NOT NULL) - Tipo da entidade alterada (ex: `contracts.contratos`, `operations.timesheets`)
- `entidade_id` (UUID, NOT NULL) - ID da entidade alterada
- `acao` (ENUM, NOT NULL) - Ação: create, update, delete
- `user_id` (UUID, FK -> auth.users.id, NOT NULL) - Usuário que realizou a ação
- `dados_anteriores` (JSONB) - Dados anteriores (snapshot)
- `dados_novos` (JSONB) - Dados novos (snapshot)
- `ip_address` (VARCHAR) - Endereço IP
- `user_agent` (VARCHAR) - User agent do navegador
- `created_at` (TIMESTAMPTZ, NOT NULL) - Data/hora da ação

**Regras de Negócio**:
- Registro imutável (apenas criação)
- Dados armazenados em JSONB para flexibilidade
- Deve registrar todas as alterações importantes do sistema
- Tipo de entidade deve seguir formato `schema.tabela`

**Índices**:
- `idx_audit_logs_tenant` (tenant_id)
- `idx_audit_logs_entidade` (tenant_id, tipo_entidade, entidade_id)
- `idx_audit_logs_user` (user_id)
- `idx_audit_logs_data` (created_at)

---

## 5. Configurações do Sistema

**Tabela**: `core.system_settings`

Configurações por tenant.

**Campos**:
- `id` (UUID, PK) - Identificador único
- `tenant_id` (UUID, FK -> core.tenants.id, NOT NULL) - Tenant
- `chave` (VARCHAR, NOT NULL) - Chave da configuração
- `valor` (TEXT) - Valor da configuração
- `tipo` (ENUM) - Tipo: string, number, boolean, json
- `categoria` (VARCHAR) - Categoria: aparencia, sistema, financeiro, etc.
- `descricao` (TEXT) - Descrição da configuração
- `created_at` (TIMESTAMPTZ) - Data de criação
- `updated_at` (TIMESTAMPTZ) - Data de atualização
- `updated_by` (UUID, FK -> auth.users.id) - Usuário que atualizou

**Configurações Principais**:
- `cor_primaria` - Cor primária da empresa
- `cor_secundaria` - Cor secundária da empresa
- `nome_empresa` - Nome da empresa
- `logo` - URL do logo

**Regras de Negócio**:
- Chave deve ser única por tenant
- Valor é armazenado como TEXT e convertido conforme tipo

**Índices**:
- `idx_system_settings_tenant` (tenant_id)
- `idx_system_settings_chave` (tenant_id, chave) UNIQUE
- `idx_system_settings_categoria` (categoria)

---

## Relacionamentos

- `tenants` → `tenant_users` (um para muitos)
- `tenants` → `roles` (um para muitos)
- `tenants` → `permissions` (um para muitos)
- `tenants` → `audit_logs` (um para muitos)
- `tenants` → `system_settings` (um para muitos)
- `roles` → `role_permissions` (um para muitos)
- `permissions` → `role_permissions` (um para muitos)
- `roles` → `user_roles` (um para muitos)
- `auth.users` → `tenant_users` (um para muitos)
- `auth.users` → `user_roles` (um para muitos)
- `auth.users` → `audit_logs` (um para muitos)
