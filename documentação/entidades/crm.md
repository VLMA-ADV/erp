# Schema `crm`

## Objetivo

Centralizar informações de **clientes e segmentações**.

---

## 1. Clientes

**Tabela**: `crm.clientes`

Cadastro completo de clientes com informações fiscais, endereço e responsáveis.

**Campos**:
- `id` (UUID, PK) - Identificador único
- `tenant_id` (UUID, FK -> core.tenants.id, NOT NULL) - Tenant
- `nome` (VARCHAR, NOT NULL) - Nome/Razão social
- `cliente_estrangeiro` (BOOLEAN, DEFAULT false) - Indica se é cliente estrangeiro
- `cnpj` (VARCHAR(14)) - CNPJ (obrigatório se não for estrangeiro)
- `tipo` (ENUM) - Tipo de cliente: pessoa_fisica, pessoa_juridica
- `rua` (VARCHAR) - Logradouro
- `numero` (VARCHAR) - Número do endereço
- `complemento` (VARCHAR) - Complemento do endereço
- `cidade` (VARCHAR) - Cidade
- `estado` (VARCHAR(2)) - Estado (UF)
- `regime_fiscal` (VARCHAR) - Regime fiscal
- `grupo_economico_id` (UUID, FK -> crm.grupos_economicos.id) - Grupo econômico
- `observacoes` (TEXT) - Observações gerais
- `created_at` (TIMESTAMPTZ) - Data de criação
- `updated_at` (TIMESTAMPTZ) - Data de atualização
- `created_by` (UUID, FK -> auth.users.id) - Usuário que criou
- `updated_by` (UUID, FK -> auth.users.id) - Usuário que atualizou

**Tabelas Relacionadas**:
- `crm.clientes_segmentos` - Relação muitos para muitos com segmentos econômicos
- `crm.clientes_responsaveis_internos` - Responsáveis internos
- `crm.clientes_responsaveis_financeiros` - Responsáveis financeiros

**Relacionamentos**:
- Pertence a: GRUPOS ECONÔMICOS (muitos para um)
- Possui: SEGMENTOS ECONÔMICOS (muitos para muitos)
- Possui: CONTRATOS (um para muitos) → `contracts.contratos`
- Possui: RESPONSÁVEIS INTERNOS (um para muitos)
- Possui: RESPONSÁVEIS FINANCEIROS (um para muitos)

**Regras de Negócio**:
- CNPJ obrigatório se não for cliente estrangeiro
- CNPJ deve ser válido e único por tenant
- Cliente estrangeiro não precisa de CNPJ
- Nome deve ser único por tenant

**Índices**:
- `idx_clientes_tenant` (tenant_id)
- `idx_clientes_cnpj` (tenant_id, cnpj) UNIQUE (quando não for estrangeiro)
- `idx_clientes_nome` (tenant_id, nome)
- `idx_clientes_grupo_economico` (grupo_economico_id)

---

## 2. Segmentos Econômicos

**Tabela**: `crm.segmentos_economicos`

Classificação econômica para segmentação de clientes.

**Campos**:
- `id` (UUID, PK) - Identificador único
- `tenant_id` (UUID, FK -> core.tenants.id, NOT NULL) - Tenant
- `nome` (VARCHAR, NOT NULL) - Nome do segmento
- `created_at` (TIMESTAMPTZ) - Data de criação
- `updated_at` (TIMESTAMPTZ) - Data de atualização
- `created_by` (UUID, FK -> auth.users.id) - Usuário que criou
- `updated_by` (UUID, FK -> auth.users.id) - Usuário que atualizou

**Relacionamentos**:
- Relacionado com: CLIENTES (muitos para muitos) via `crm.clientes_segmentos`

**Regras de Negócio**:
- Nome deve ser único por tenant

**Índices**:
- `idx_segmentos_tenant` (tenant_id)
- `idx_segmentos_nome` (tenant_id, nome) UNIQUE

---

## 3. Grupos Econômicos

**Tabela**: `crm.grupos_economicos`

Agrupamento de clientes relacionados economicamente.

**Campos**:
- `id` (UUID, PK) - Identificador único
- `tenant_id` (UUID, FK -> core.tenants.id, NOT NULL) - Tenant
- `nome` (VARCHAR, NOT NULL) - Nome do grupo
- `created_at` (TIMESTAMPTZ) - Data de criação
- `updated_at` (TIMESTAMPTZ) - Data de atualização
- `created_by` (UUID, FK -> auth.users.id) - Usuário que criou
- `updated_by` (UUID, FK -> auth.users.id) - Usuário que atualizou

**Relacionamentos**:
- Relacionado com: CLIENTES (um para muitos)

**Regras de Negócio**:
- Nome deve ser único por tenant

**Índices**:
- `idx_grupos_tenant` (tenant_id)
- `idx_grupos_nome` (tenant_id, nome) UNIQUE

---

## 4. Clientes Segmentos (Junction Table)

**Tabela**: `crm.clientes_segmentos`

Relação muitos para muitos entre clientes e segmentos econômicos.

**Campos**:
- `id` (UUID, PK) - Identificador único
- `cliente_id` (UUID, FK -> crm.clientes.id, NOT NULL) - Cliente
- `segmento_id` (UUID, FK -> crm.segmentos_economicos.id, NOT NULL) - Segmento
- `created_at` (TIMESTAMPTZ) - Data de criação

**Regras de Negócio**:
- Combinação cliente_id + segmento_id deve ser única

**Índices**:
- `idx_clientes_segmentos_cliente` (cliente_id)
- `idx_clientes_segmentos_segmento` (segmento_id)
- `idx_clientes_segmentos_unique` (cliente_id, segmento_id) UNIQUE

---

## 5. Responsáveis Internos

**Tabela**: `crm.clientes_responsaveis_internos`

Responsáveis internos do cliente.

**Campos**:
- `id` (UUID, PK) - Identificador único
- `cliente_id` (UUID, FK -> crm.clientes.id, NOT NULL) - Cliente
- `nome` (VARCHAR, NOT NULL) - Nome do responsável
- `email` (VARCHAR) - E-mail
- `whatsapp` (VARCHAR) - WhatsApp
- `data_nascimento` (DATE) - Data de nascimento
- `created_at` (TIMESTAMPTZ) - Data de criação
- `updated_at` (TIMESTAMPTZ) - Data de atualização

**Relacionamentos**:
- Pertence a: CLIENTE (muitos para um)

**Índices**:
- `idx_responsaveis_internos_cliente` (cliente_id)

---

## 6. Responsáveis Financeiros

**Tabela**: `crm.clientes_responsaveis_financeiros`

Responsáveis financeiros do cliente.

**Campos**:
- `id` (UUID, PK) - Identificador único
- `cliente_id` (UUID, FK -> crm.clientes.id, NOT NULL) - Cliente
- `nome` (VARCHAR, NOT NULL) - Nome do responsável
- `email` (VARCHAR) - E-mail
- `whatsapp` (VARCHAR) - WhatsApp
- `created_at` (TIMESTAMPTZ) - Data de criação
- `updated_at` (TIMESTAMPTZ) - Data de atualização

**Relacionamentos**:
- Pertence a: CLIENTE (muitos para um)

**Índices**:
- `idx_responsaveis_financeiros_cliente` (cliente_id)

---

## Relacionamentos

- `crm.grupos_economicos` → `crm.clientes` (um para muitos)
- `crm.clientes` ↔ `crm.segmentos_economicos` (muitos para muitos via `crm.clientes_segmentos`)
- `crm.clientes` → `crm.clientes_responsaveis_internos` (um para muitos)
- `crm.clientes` → `crm.clientes_responsaveis_financeiros` (um para muitos)
- `crm.clientes` → `contracts.contratos` (um para muitos)
- `core.tenants` → `crm.clientes` (um para muitos)
- `core.tenants` → `crm.segmentos_economicos` (um para muitos)
- `core.tenants` → `crm.grupos_economicos` (um para muitos)
