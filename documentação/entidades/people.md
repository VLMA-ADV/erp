# Schema `people`

## Objetivo

Gerenciar **pessoas internas**, sua estrutura organizacional e avaliações.

---

## 1. Colaboradores

**Tabela**: `people.colaboradores`

Representa o perfil interno do usuário. A autenticação é feita via Supabase Auth (`auth.users`).

**Campos**:
- `id` (UUID, PK) - Identificador único
- `tenant_id` (UUID, FK -> core.tenants.id, NOT NULL) - Tenant
- `user_id` (UUID, FK -> auth.users.id, UNIQUE, NOT NULL) - Usuário autenticado
- `nome` (VARCHAR, NOT NULL) - Nome completo
- `data_nascimento` (DATE) - Data de nascimento
- `categoria` (ENUM, NOT NULL) - Categoria: socio, advogado, administrativo, estagiario
- `cpf` (VARCHAR(11), NOT NULL) - CPF
- `oab` (VARCHAR) - Número OAB (opcional, apenas para advogados)
- `rua` (VARCHAR) - Logradouro
- `numero` (VARCHAR) - Número do endereço
- `complemento` (VARCHAR) - Complemento do endereço
- `cidade` (VARCHAR) - Cidade
- `estado` (VARCHAR(2)) - Estado (UF)
- `email` (VARCHAR, UNIQUE, NOT NULL) - Email (deve corresponder ao auth.users.email)
- `whatsapp` (VARCHAR) - WhatsApp
- `area_id` (UUID, FK -> people.areas.id) - Área/centro de custo
- `cargo_id` (UUID, FK -> people.cargos.id, NOT NULL) - Cargo do colaborador
- `adicional` (ENUM) - Adicional: lideranca, estrategico (null se não houver)
- `percentual_adicional` (DECIMAL(5,2)) - Percentual de adicional (5% a 20%, apenas se adicional não for null)
- `salario` (DECIMAL(10,2)) - Salário base
- `banco` (VARCHAR) - Nome do banco
- `conta_com_digito` (VARCHAR) - Conta com dígito
- `agencia` (VARCHAR) - Agência
- `chave_pix` (VARCHAR) - Chave PIX
- `ativo` (BOOLEAN, DEFAULT true) - Indica se está ativo
- `created_at` (TIMESTAMPTZ) - Data de criação
- `updated_at` (TIMESTAMPTZ) - Data de atualização
- `created_by` (UUID, FK -> auth.users.id) - Usuário que criou
- `updated_by` (UUID, FK -> auth.users.id) - Usuário que atualizou

**Tabelas Relacionadas**:
- `people.colaboradores_beneficios` - Benefícios do colaborador

**Relacionamentos**:
- Pertence a: ÁREAS (muitos para um)
- Pertence a: CARGO (muitos para um)
- Possui: BENEFÍCIOS (muitos para muitos)
- Possui: AVALIAÇÕES PDI (um para muitos)
- Possui: TIMESHEETS (um para muitos) → `operations.timesheets`
- Possui: CONTRATOS (como responsável) → `contracts.contratos`
- Relacionado com: AUTH.USERS (um para um)

**Regras de Negócio**:
- CPF deve ser único por tenant e válido
- Email deve ser único por tenant e corresponder ao auth.users.email
- OAB obrigatório apenas para categoria "advogado"
- Percentual adicional obrigatório se adicional não for null
- Percentual adicional deve estar entre 5% e 20%
- Cargo determina faixa salarial base
- Autenticação **não** é feita aqui; é responsabilidade do Supabase Auth

**Índices**:
- `idx_colaboradores_tenant` (tenant_id)
- `idx_colaboradores_user` (user_id) UNIQUE
- `idx_colaboradores_cpf` (tenant_id, cpf) UNIQUE
- `idx_colaboradores_email` (tenant_id, email) UNIQUE
- `idx_colaboradores_oab` (oab)
- `idx_colaboradores_area` (area_id)
- `idx_colaboradores_cargo` (cargo_id)

---

## 2. Benefícios do Colaborador

**Tabela**: `people.colaboradores_beneficios`

Benefícios do colaborador.

**Campos**:
- `id` (UUID, PK) - Identificador único
- `colaborador_id` (UUID, FK -> people.colaboradores.id, NOT NULL) - Colaborador
- `beneficio` (ENUM, NOT NULL) - Plano de Saúde, Auxílio Previdenciária
- `created_at` (TIMESTAMPTZ) - Data de criação

**Relacionamentos**:
- Pertence a: COLABORADOR (muitos para um)

**Índices**:
- `idx_colaboradores_beneficios_colaborador` (colaborador_id)

---

## 3. Cargos

**Tabela**: `people.cargos`

Cargos da empresa. Representam hierarquia e carreira, **não permissões** (permissões são gerenciadas via RBAC no schema `core`).

**Campos**:
- `id` (UUID, PK) - Identificador único
- `tenant_id` (UUID, FK -> core.tenants.id, NOT NULL) - Tenant
- `nome` (VARCHAR, NOT NULL) - Nome do cargo (ex: Estagiário, Administrativo, Junior 1, Pleno 1, Senior 1, Jr Partner)
- `codigo` (VARCHAR, NOT NULL) - Código do cargo
- `nivel` (INTEGER) - Nível hierárquico (para ordenação)
- `ativo` (BOOLEAN, DEFAULT true) - Indica se está ativo
- `created_at` (TIMESTAMPTZ) - Data de criação
- `updated_at` (TIMESTAMPTZ) - Data de atualização
- `created_by` (UUID, FK -> auth.users.id) - Usuário que criou
- `updated_by` (UUID, FK -> auth.users.id) - Usuário que atualizou

**Tabelas Relacionadas**:
- `people.cargos_features` - Features do cargo (mantida para compatibilidade, mas permissões via RBAC)

**Relacionamentos**:
- Possui: FEATURES (muitos para muitos) - **Nota**: Features são mantidas para referência, mas permissões reais vêm do RBAC
- Relacionado com: COLABORADORES (um para muitos)

**Regras de Negócio**:
- Código deve ser único por tenant
- Cargos possíveis: Estagiário, Administrativo, Junior 1-5, Pleno 1-5, Senior 1-8, Jr Partner
- Features definem características do cargo, mas permissões são gerenciadas via RBAC

**Índices**:
- `idx_cargos_tenant` (tenant_id)
- `idx_cargos_nome` (tenant_id, nome)
- `idx_cargos_codigo` (tenant_id, codigo) UNIQUE

---

## 4. Features do Cargo

**Tabela**: `people.cargos_features`

Features/permissões do cargo. **Nota**: Mantida para compatibilidade, mas permissões reais são gerenciadas via RBAC no schema `core`.

**Campos**:
- `id` (UUID, PK) - Identificador único
- `cargo_id` (UUID, FK -> people.cargos.id, NOT NULL) - Cargo
- `feature` (VARCHAR, NOT NULL) - Nome da feature/permissão
- `permitido` (BOOLEAN, DEFAULT true) - Indica se a feature está permitida
- `created_at` (TIMESTAMPTZ) - Data de criação

**Relacionamentos**:
- Pertence a: CARGO (muitos para um)

**Índices**:
- `idx_cargos_features_cargo` (cargo_id)

---

## 5. Áreas

**Tabela**: `people.areas`

Áreas de atuação da empresa.

**Campos**:
- `id` (UUID, PK) - Identificador único
- `tenant_id` (UUID, FK -> core.tenants.id, NOT NULL) - Tenant
- `nome` (VARCHAR, NOT NULL) - Nome da área
- `codigo` (VARCHAR, NOT NULL) - Código da área
- `centro_custo_id` (UUID, FK -> people.centros_custo.id) - Centro de custo relacionado
- `ativo` (BOOLEAN, DEFAULT true) - Indica se está ativa
- `created_at` (TIMESTAMPTZ) - Data de criação
- `updated_at` (TIMESTAMPTZ) - Data de atualização
- `created_by` (UUID, FK -> auth.users.id) - Usuário que criou
- `updated_by` (UUID, FK -> auth.users.id) - Usuário que atualizou

**Relacionamentos**:
- Relacionado com: CENTROS DE CUSTO (muitos para um)
- Relacionado com: COLABORADORES (um para muitos)

**Regras de Negócio**:
- Código deve ser único por tenant
- Área pode estar vinculada a um centro de custo

**Índices**:
- `idx_areas_tenant` (tenant_id)
- `idx_areas_nome` (tenant_id, nome)
- `idx_areas_codigo` (tenant_id, codigo) UNIQUE
- `idx_areas_centro_custo` (centro_custo_id)

---

## 6. Centros de Custo

**Tabela**: `people.centros_custo`

Divisão de custos por área/centro da empresa.

**Campos**:
- `id` (UUID, PK) - Identificador único
- `tenant_id` (UUID, FK -> core.tenants.id, NOT NULL) - Tenant
- `nome` (VARCHAR, NOT NULL) - Nome do centro de custo
- `codigo` (VARCHAR, NOT NULL) - Código do centro de custo
- `ativo` (BOOLEAN, DEFAULT true) - Indica se está ativo
- `created_at` (TIMESTAMPTZ) - Data de criação
- `updated_at` (TIMESTAMPTZ) - Data de atualização
- `created_by` (UUID, FK -> auth.users.id) - Usuário que criou
- `updated_by` (UUID, FK -> auth.users.id) - Usuário que atualizou

**Relacionamentos**:
- Relacionado com: CASOS (muitos para muitos) via `contracts.casos_centros_custo`
- Relacionado com: ÁREAS (um para muitos)

**Regras de Negócio**:
- Código deve ser único por tenant
- Centros possíveis: Societário, Tributário, Contratos, Trabalhista, Agro, Contencioso Cível

**Índices**:
- `idx_centros_custo_tenant` (tenant_id)
- `idx_centros_custo_nome` (tenant_id, nome)
- `idx_centros_custo_codigo` (tenant_id, codigo) UNIQUE

---

## 7. Avaliação PDI

**Tabela**: `people.avaliacoes_pdi`

Sistema de avaliação de desempenho individual dos colaboradores.

**Campos**:
- `id` (UUID, PK) - Identificador único
- `tenant_id` (UUID, FK -> core.tenants.id, NOT NULL) - Tenant
- `ano` (INTEGER, NOT NULL) - Ano de avaliação
- `tipo` (ENUM, NOT NULL) - Tipo: previa, definitiva
- `colaborador_id` (UUID, FK -> people.colaboradores.id, NOT NULL) - Colaborador avaliado
- `bonus_pdi` (BOOLEAN, DEFAULT false) - Indica se recebeu bônus PDI
- `bonus_performance_plus` (DECIMAL(10,2)) - Valor do bônus performance plus
- `bonus_comercial` (DECIMAL(10,2)) - Valor do bônus comercial
- `nota_final` (DECIMAL(5,2)) - Nota final calculada
- `resultado` (ENUM) - Resultado: mantem_faixa_atual, progressao_simples, progressao_diferenciada
- `observacoes` (TEXT) - Observações gerais
- `created_at` (TIMESTAMPTZ) - Data de criação
- `updated_at` (TIMESTAMPTZ) - Data de atualização
- `created_by` (UUID, FK -> auth.users.id) - Usuário que criou
- `updated_by` (UUID, FK -> auth.users.id) - Usuário que atualizou

**Tabelas Relacionadas**:
- `people.avaliacoes_pdi_dna_vlma` - DNA VLMA
- `people.avaliacoes_pdi_skills_carreira` - Skills da Carreira
- `people.avaliacoes_pdi_metas_individuais` - Metas Individuais

**Relacionamentos**:
- Pertence a: COLABORADOR (muitos para um)
- Possui: DNA VLMA (um para um)
- Possui: SKILLS DA CARREIRA (um para muitos, até 8 campos)
- Possui: METAS INDIVIDUAIS (um para muitos, até 5 campos)

**Regras de Negócio**:
- Skills da Carreira: 5 campos se cargo normal, +3 campos se adicional = "Liderança" ou "Estratégico" (total 8)
- Metas Individuais: máximo 5 campos
- Nota final = média simples de todos os itens (DNA VLMA + Skills + Metas)
- Notas devem estar entre 0 e 10
- Calendário PDI:
  - Avaliação prévia: Junho
  - Avaliação definitiva: Janeiro
  - Aplicação do reajuste: Fevereiro
- Resultado determina progressão salarial

**Índices**:
- `idx_avaliacoes_pdi_tenant` (tenant_id)
- `idx_avaliacoes_pdi_colaborador` (colaborador_id)
- `idx_avaliacoes_pdi_ano_tipo` (ano, tipo)

---

## 8. DNA VLMA

**Tabela**: `people.avaliacoes_pdi_dna_vlma`

DNA VLMA da avaliação PDI.

**Campos**:
- `id` (UUID, PK) - Identificador único
- `avaliacao_pdi_id` (UUID, FK -> people.avaliacoes_pdi.id, NOT NULL, UNIQUE) - Avaliação PDI
- `nome` (VARCHAR, NOT NULL) - Nome do item
- `descricao` (TEXT) - Descrição
- `nota` (DECIMAL(3,1), NOT NULL) - Nota de 0 a 10
- `created_at` (TIMESTAMPTZ) - Data de criação
- `updated_at` (TIMESTAMPTZ) - Data de atualização

**Relacionamentos**:
- Pertence a: AVALIAÇÃO PDI (um para um)

**Índices**:
- `idx_avaliacoes_pdi_dna_avaliacao` (avaliacao_pdi_id) UNIQUE

---

## 9. Skills da Carreira

**Tabela**: `people.avaliacoes_pdi_skills_carreira`

Skills da Carreira da avaliação PDI.

**Campos**:
- `id` (UUID, PK) - Identificador único
- `avaliacao_pdi_id` (UUID, FK -> people.avaliacoes_pdi.id, NOT NULL) - Avaliação PDI
- `nome` (VARCHAR, NOT NULL) - Nome do skill
- `descricao` (TEXT) - Descrição
- `nota` (DECIMAL(3,1), NOT NULL) - Nota de 0 a 10
- `ordem` (INTEGER) - Ordem do skill
- `created_at` (TIMESTAMPTZ) - Data de criação
- `updated_at` (TIMESTAMPTZ) - Data de atualização

**Relacionamentos**:
- Pertence a: AVALIAÇÃO PDI (muitos para um)

**Regras de Negócio**:
- Máximo 8 skills (5 base + 3 se adicional = Liderança ou Estratégico)

**Índices**:
- `idx_avaliacoes_pdi_skills_avaliacao` (avaliacao_pdi_id)

---

## 10. Metas Individuais

**Tabela**: `people.avaliacoes_pdi_metas_individuais`

Metas Individuais da avaliação PDI.

**Campos**:
- `id` (UUID, PK) - Identificador único
- `avaliacao_pdi_id` (UUID, FK -> people.avaliacoes_pdi.id, NOT NULL) - Avaliação PDI
- `nome` (VARCHAR, NOT NULL) - Nome da meta
- `descricao` (TEXT) - Descrição
- `nota` (DECIMAL(3,1), NOT NULL) - Nota de 0 a 10
- `ordem` (INTEGER) - Ordem da meta
- `created_at` (TIMESTAMPTZ) - Data de criação
- `updated_at` (TIMESTAMPTZ) - Data de atualização

**Relacionamentos**:
- Pertence a: AVALIAÇÃO PDI (muitos para um)

**Regras de Negócio**:
- Máximo 5 metas

**Índices**:
- `idx_avaliacoes_pdi_metas_avaliacao` (avaliacao_pdi_id)

---

## Relacionamentos

- `people.areas` → `people.colaboradores` (um para muitos)
- `people.cargos` → `people.colaboradores` (um para muitos)
- `people.centros_custo` → `people.areas` (um para muitos)
- `people.colaboradores` → `people.colaboradores_beneficios` (um para muitos)
- `people.colaboradores` → `people.avaliacoes_pdi` (um para muitos)
- `people.avaliacoes_pdi` → `people.avaliacoes_pdi_dna_vlma` (um para um)
- `people.avaliacoes_pdi` → `people.avaliacoes_pdi_skills_carreira` (um para muitos)
- `people.avaliacoes_pdi` → `people.avaliacoes_pdi_metas_individuais` (um para muitos)
- `people.cargos` → `people.cargos_features` (um para muitos)
- `auth.users` → `people.colaboradores` (um para um)
- `core.tenants` → `people.colaboradores` (um para muitos)
- `core.tenants` → `people.cargos` (um para muitos)
- `core.tenants` → `people.areas` (um para muitos)
- `core.tenants` → `people.centros_custo` (um para muitos)
- `core.tenants` → `people.avaliacoes_pdi` (um para muitos)
