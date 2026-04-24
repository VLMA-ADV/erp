# Schema `contracts`

## Objetivo

Modelar contratos jurídicos e seus escopos (casos), incluindo regras financeiras, configurações de timesheet, despesas reembolsáveis e indicações.

---

## 1. Produtos

**Tabela**: `contracts.produtos`

Catálogo de produtos oferecidos pela empresa.

**Campos**:
- `id` (UUID, PK) - Identificador único
- `tenant_id` (UUID, FK -> core.tenants.id, NOT NULL) - Tenant
- `nome` (VARCHAR, NOT NULL) - Nome do produto
- `created_at` (TIMESTAMPTZ) - Data de criação
- `updated_at` (TIMESTAMPTZ) - Data de atualização
- `created_by` (UUID, FK -> auth.users.id) - Usuário que criou
- `updated_by` (UUID, FK -> auth.users.id) - Usuário que atualizou

**Relacionamentos**:
- Relacionado com: CASOS (muitos para um)

**Regras de Negócio**:
- Nome deve ser único por tenant

**Índices**:
- `idx_produtos_tenant` (tenant_id)
- `idx_produtos_nome` (tenant_id, nome) UNIQUE

---

## 2. Contratos

**Tabela**: `contracts.contratos`

Contratos de honorários com casos, regras financeiras, despesas e timesheet.

**Campos**:
- `id` (UUID, PK) - Identificador único
- `tenant_id` (UUID, FK -> core.tenants.id, NOT NULL) - Tenant
- `cliente_id` (UUID, FK -> crm.clientes.id, NOT NULL) - Cliente
- `regime_pagamento` (VARCHAR, NOT NULL) - Regime de pagamento (lista de impostos)
- `nome_contrato` (VARCHAR, NOT NULL) - Nome/identificação do contrato
- `exibir_timesheet` (BOOLEAN, NOT NULL, DEFAULT false) - Indica se exibe timesheet
- `proposta_anexo_id` (UUID, FK -> documents.documentos.id) - Anexo da proposta (GED)
- `status` (ENUM, NOT NULL) - Status: ativo, finalizado
- `created_at` (TIMESTAMPTZ) - Data de criação
- `updated_at` (TIMESTAMPTZ) - Data de atualização
- `created_by` (UUID, FK -> auth.users.id) - Usuário que criou
- `updated_by` (UUID, FK -> auth.users.id) - Usuário que atualizou

**Tabelas Relacionadas**:
- `contracts.contratos_casos` - Casos/Escopos do contrato
- `contracts.contratos_pagadores` - Pagadores do contrato
- `contracts.contratos_despesas_reembolsaveis` - Despesas reembolsáveis
- `contracts.contratos_rateio_pagadores` - Rateio de pagadores para despesas
- `contracts.contratos_timesheet_config` - Configuração de timesheet
- `contracts.contratos_indicacoes_config` - Indicações de negócios

**Relacionamentos**:
- Pertence a: CLIENTE (muitos para um) → `crm.clientes`
- Possui: CASOS (um para muitos)
- Possui: PAGADORES (muitos para muitos)
- Possui: DESPESAS REEMBOLSÁVEIS (um para um)
- Possui: TIMESHEET CONFIG (um para um)
- Possui: INDICAÇÕES CONFIG (um para um, opcional)
- Possui: FATURAMENTOS (um para muitos) → `finance.faturamentos`

**Regras de Negócio**:
- Um contrato pode ter múltiplos casos/escopos
- Cada caso funciona como um mini-contrato independente
- Status determina se o contrato está ativo ou finalizado
- Nome do contrato deve ser único por tenant

**Índices**:
- `idx_contratos_tenant` (tenant_id)
- `idx_contratos_cliente` (cliente_id)
- `idx_contratos_status` (status)
- `idx_contratos_nome` (tenant_id, nome)

---

## 3. Casos (Escopos do Contrato)

**Tabela**: `contracts.casos`

Casos/Escopos dentro de um contrato. Cada caso representa um escopo de trabalho diferente.

**Campos**:
- `id` (UUID, PK) - Identificador único
- `contrato_id` (UUID, FK -> contracts.contratos.id, NOT NULL) - Contrato pai
- `nome` (VARCHAR, NOT NULL) - Nome do caso/escopo (ex: Planejamento Tributário)
- `produto_id` (UUID, FK -> contracts.produtos.id) - Produto relacionado
- `responsavel_id` (UUID, FK -> people.colaboradores.id) - Responsável pelo caso
- `created_at` (TIMESTAMPTZ) - Data de criação
- `updated_at` (TIMESTAMPTZ) - Data de atualização
- `created_by` (UUID, FK -> auth.users.id) - Usuário que criou
- `updated_by` (UUID, FK -> auth.users.id) - Usuário que atualizou

**Tabelas Relacionadas**:
- `contracts.casos_centros_custo` - Centros de custo do caso

**Relacionamentos**:
- Pertence a: CONTRATO (muitos para um)
- Relacionado com: PRODUTO (muitos para um)
- Relacionado com: COLABORADOR (responsável, muitos para um) → `people.colaboradores`
- Possui: CENTROS DE CUSTO (muitos para muitos) via `contracts.casos_centros_custo`
- Possui: REGRAS FINANCEIRAS (um para um)
- Possui: TIMESHEETS (um para muitos) → `operations.timesheets`
- Possui: FATURAMENTOS (um para muitos) via `finance.faturamentos_casos`
- Possui: DESPESAS (um para muitos) → `operations.despesas`

**Regras de Negócio**:
- Cada caso pode ter múltiplos centros de custo
- Centros de custo possíveis: Societário, Tributário, Contratos, Trabalhista, Agro, Contencioso Cível
- Cada caso tem sua própria jornada completa

**Índices**:
- `idx_casos_contrato` (contrato_id)
- `idx_casos_responsavel` (responsavel_id)
- `idx_casos_produto` (produto_id)

---

## 4. Casos Centros de Custo (Junction Table)

**Tabela**: `contracts.casos_centros_custo`

Relação muitos para muitos entre casos e centros de custo.

**Campos**:
- `id` (UUID, PK) - Identificador único
- `caso_id` (UUID, FK -> contracts.casos.id, NOT NULL) - Caso
- `centro_custo_id` (UUID, FK -> people.centros_custo.id, NOT NULL) - Centro de custo
- `created_at` (TIMESTAMPTZ) - Data de criação

**Regras de Negócio**:
- Combinação caso_id + centro_custo_id deve ser única

**Índices**:
- `idx_casos_centros_custo_caso` (caso_id)
- `idx_casos_centros_custo_centro` (centro_custo_id)
- `idx_casos_centros_custo_unique` (caso_id, centro_custo_id) UNIQUE

---

## 5. Regras Financeiras

**Tabela**: `contracts.regras_financeiras`

Regras de cobrança e faturamento para cada caso.

**Campos**:
- `id` (UUID, PK) - Identificador único
- `caso_id` (UUID, FK -> contracts.casos.id, NOT NULL, UNIQUE) - Caso relacionado
- `moeda` (ENUM, NOT NULL) - Moeda: real, cambio
- `tipo_nota` (ENUM, NOT NULL) - Tipo: nota_fiscal, invoice
- `data_inicio_faturamento` (DATE, NOT NULL) - Data de início do faturamento
- `data_pagamento` (DATE) - Data prevista de pagamento
- `inicio_proposta` (DATE) - Data de início da proposta
- `data_reajuste_monetario` (DATE) - Data do reajuste monetário
- `indice_reajuste` (DECIMAL(5,2)) - Percentual de reajuste da hora
- `created_at` (TIMESTAMPTZ) - Data de criação
- `updated_at` (TIMESTAMPTZ) - Data de atualização
- `created_by` (UUID, FK -> auth.users.id) - Usuário que criou
- `updated_by` (UUID, FK -> auth.users.id) - Usuário que atualizou

**Tabelas Relacionadas**:
- `contracts.regras_financeiras_tipos_cobranca` - Tipos de cobrança (múltipla seleção)

**Relacionamentos**:
- Pertence a: CASO (um para um)
- Possui: TIPOS DE COBRANÇA (muitos para muitos)
- Relacionado com: FATURAMENTOS (um para muitos) → `finance.faturamentos`

**Regras de Negócio**:
- Múltiplos tipos de cobrança podem ser selecionados
- Tipos possíveis: Hora, Hora com limite (cap), Mensal, Mensalidade de processo, Projeto, Projeto Parcelado, Êxito
- Índice de reajuste usado para calcular automaticamente o reajuste da hora

**Índices**:
- `idx_regras_financeiras_caso` (caso_id) UNIQUE

---

## 6. Tipos de Cobrança

**Tabela**: `contracts.regras_financeiras_tipos_cobranca`

Tipos de cobrança das regras financeiras (múltipla seleção).

**Campos**:
- `id` (UUID, PK) - Identificador único
- `regra_financeira_id` (UUID, FK -> contracts.regras_financeiras.id, NOT NULL) - Regra financeira
- `tipo_cobranca` (ENUM, NOT NULL) - Hora, Hora_com_limite, Mensal, Mensalidade_processo, Projeto, Projeto_parcelado, Exito
- `created_at` (TIMESTAMPTZ) - Data de criação

**Relacionamentos**:
- Pertence a: REGRA FINANCEIRA (muitos para um)

**Regras de Negócio**:
- Combinação regra_financeira_id + tipo_cobranca deve ser única

**Índices**:
- `idx_regras_financeiras_tipos_regra` (regra_financeira_id)
- `idx_regras_financeiras_tipos_unique` (regra_financeira_id, tipo_cobranca) UNIQUE

---

## 7. Pagadores do Contrato

**Tabela**: `contracts.contratos_pagadores`

Clientes que são pagadores de um contrato.

**Campos**:
- `id` (UUID, PK) - Identificador único
- `contrato_id` (UUID, FK -> contracts.contratos.id, NOT NULL) - Contrato
- `cliente_id` (UUID, FK -> crm.clientes.id, NOT NULL) - Cliente pagador
- `created_at` (TIMESTAMPTZ) - Data de criação

**Relacionamentos**:
- Pertence a: CONTRATO (muitos para um)
- Relacionado com: CLIENTE (muitos para um) → `crm.clientes`

**Regras de Negócio**:
- Múltiplos clientes podem ser pagadores de um contrato
- Combinação contrato_id + cliente_id deve ser única

**Índices**:
- `idx_contratos_pagadores_contrato` (contrato_id)
- `idx_contratos_pagadores_cliente` (cliente_id)
- `idx_contratos_pagadores_unique` (contrato_id, cliente_id) UNIQUE

---

## 8. Despesas Reembolsáveis

**Tabela**: `contracts.contratos_despesas_reembolsaveis`

Configuração de despesas reembolsáveis do contrato.

**Campos**:
- `id` (UUID, PK) - Identificador único
- `contrato_id` (UUID, FK -> contracts.contratos.id, NOT NULL, UNIQUE) - Contrato
- `despesas_reembolsaveis` (VARCHAR[]) - Lista de despesas reembolsáveis (primeira opção = "não")
- `limite_adiantamento` (DECIMAL(10,2)) - Limite de adiantamento
- `created_at` (TIMESTAMPTZ) - Data de criação
- `updated_at` (TIMESTAMPTZ) - Data de atualização

**Tabelas Relacionadas**:
- `contracts.contratos_rateio_pagadores` - Rateio de pagadores

**Relacionamentos**:
- Pertence a: CONTRATO (um para um)
- Possui: RATEIO DE PAGADORES (um para muitos)

**Regras de Negócio**:
- Primeira opção padrão é "não" (sem despesas reembolsáveis)

**Índices**:
- `idx_despesas_reembolsaveis_contrato` (contrato_id) UNIQUE

---

## 9. Rateio de Pagadores

**Tabela**: `contracts.contratos_rateio_pagadores`

Rateio de pagadores para despesas reembolsáveis.

**Campos**:
- `id` (UUID, PK) - Identificador único
- `despesa_reembolsavel_id` (UUID, FK -> contracts.contratos_despesas_reembolsaveis.id, NOT NULL) - Despesa reembolsável
- `cliente_id` (UUID, FK -> crm.clientes.id, NOT NULL) - Cliente pagador
- `proporcao_pagamento` (DECIMAL(5,2)) - Proporção de pagamento (percentual)
- `valor` (DECIMAL(10,2)) - Valor fixo (alternativa à proporção)
- `created_at` (TIMESTAMPTZ) - Data de criação
- `updated_at` (TIMESTAMPTZ) - Data de atualização

**Relacionamentos**:
- Pertence a: DESPESAS REEMBOLSÁVEIS (muitos para um)
- Relacionado com: CLIENTE (muitos para um) → `crm.clientes`

**Regras de Negócio**:
- Pode usar proporção (percentual) ou valor fixo
- Se usar proporção, valores devem somar 100%

**Índices**:
- `idx_rateio_despesa` (despesa_reembolsavel_id)
- `idx_rateio_cliente` (cliente_id)

---

## 10. Timesheet Config

**Tabela**: `contracts.contratos_timesheet_config`

Configuração de timesheet para o contrato. Define se envia timesheet ao cliente e configura revisores de faturamento.

**Campos**:
- `id` (UUID, PK) - Identificador único
- `contrato_id` (UUID, FK -> contracts.contratos.id, NOT NULL, UNIQUE) - Contrato
- `envia_timesheet_cliente` (BOOLEAN, DEFAULT false) - Indica se envia timesheet ao cliente
- `created_at` (TIMESTAMPTZ) - Data de criação
- `updated_at` (TIMESTAMPTZ) - Data de atualização

**Tabelas Relacionadas**:
- `contracts.revisores_faturamento_config` - Revisores de faturamento do contrato (com ordem)

**Relacionamentos**:
- Pertence a: CONTRATO (um para um)
- Possui: REVISORES DE FATURAMENTO CONFIG (um para muitos)

**Regras de Negócio**:
- Revisores são para revisão de FATURAMENTO, não de timesheet
- Timesheets são aprovados automaticamente após envio
- Revisão de timesheets ocorre apenas durante a revisão do faturamento
- Revisores devem ser sócios, administrativos ou advogados
- Múltiplos revisores podem ser configurados com ordem sequencial
- Sócio e Administrativo podem revisar qualquer faturamento (não precisam estar configurados)
- Advogado só pode revisar faturamentos onde está configurado como revisor

**Índices**:
- `idx_timesheet_config_contrato` (contrato_id) UNIQUE

---

## 11. Revisores de Faturamento Config

**Tabela**: `contracts.revisores_faturamento_config`

Revisores de faturamento configurados para o contrato, com ordem sequencial de revisão.

**Campos**:
- `id` (UUID, PK) - Identificador único
- `timesheet_config_id` (UUID, FK -> contracts.contratos_timesheet_config.id, NOT NULL) - Configuração de timesheet do contrato
- `colaborador_id` (UUID, FK -> people.colaboradores.id, NOT NULL) - Revisor (sócio, administrativo ou advogado)
- `ordem` (INTEGER, NOT NULL) - Ordem de revisão (1 = primário, 2 = secundário, etc.)
- `ativo` (BOOLEAN, DEFAULT true) - Indica se está ativo
- `created_at` (TIMESTAMPTZ) - Data de criação
- `updated_at` (TIMESTAMPTZ) - Data de atualização

**Relacionamentos**:
- Pertence a: TIMESHEET CONFIG (muitos para um)
- Relacionado com: COLABORADOR (muitos para um) → `people.colaboradores`

**Regras de Negócio**:
- Ordem deve ser única por configuração de timesheet
- Revisores devem ser sócios, administrativos ou advogados
- Revisão ocorre sequencialmente conforme ordem durante a revisão do faturamento
- Revisores podem editar timesheets durante a revisão do faturamento
- Sócio e Administrativo podem revisar mesmo sem estar configurados (acesso geral)

**Índices**:
- `idx_revisores_faturamento_config` (timesheet_config_id)
- `idx_revisores_faturamento_ordem` (timesheet_config_id, ordem) UNIQUE

---

## 12. Indicações Config

**Tabela**: `contracts.contratos_indicacoes_config`

Configuração de pagamento de indicações para o contrato.

**Campos**:
- `id` (UUID, PK) - Identificador único
- `contrato_id` (UUID, FK -> contracts.contratos.id, NOT NULL, UNIQUE) - Contrato
- `pessoa_id` (UUID, FK -> people.colaboradores.id) - Pessoa que receberá a indicação (primeira opção = null/não)
- `periodicidade` (ENUM) - Periodicidade: mensal, ao_final, pontual (primeira opção = null/não)
- `valor` (DECIMAL(10,2)) - Valor fixo (primeira opção = null/0)
- `percentual` (DECIMAL(5,2)) - Percentual (primeira opção = null/0)
- `created_at` (TIMESTAMPTZ) - Data de criação
- `updated_at` (TIMESTAMPTZ) - Data de atualização

**Relacionamentos**:
- Pertence a: CONTRATO (um para um, opcional)
- Relacionado com: COLABORADOR (pessoa indicada, muitos para um) → `people.colaboradores`

**Regras de Negócio**:
- Primeira opção padrão é "não" (sem pagamento de indicação)
- Pode usar valor fixo ou percentual
- Periodicidade determina quando o pagamento é feito

**Índices**:
- `idx_indicacoes_contrato` (contrato_id) UNIQUE

---

## Relacionamentos

- `crm.clientes` → `contracts.contratos` (um para muitos)
- `contracts.contratos` → `contracts.casos` (um para muitos)
- `contracts.produtos` → `contracts.casos` (muitos para um)
- `people.colaboradores` → `contracts.casos` (responsável, muitos para um)
- `people.centros_custo` ↔ `contracts.casos` (muitos para muitos via `contracts.casos_centros_custo`)
- `contracts.casos` → `contracts.regras_financeiras` (um para um)
- `contracts.regras_financeiras` → `contracts.regras_financeiras_tipos_cobranca` (um para muitos)
- `contracts.contratos` → `contracts.contratos_pagadores` (um para muitos)
- `crm.clientes` → `contracts.contratos_pagadores` (muitos para um)
- `contracts.contratos` → `contracts.contratos_despesas_reembolsaveis` (um para um)
- `contracts.contratos_despesas_reembolsaveis` → `contracts.contratos_rateio_pagadores` (um para muitos)
- `contracts.contratos` → `contracts.contratos_timesheet_config` (um para um)
- `contracts.contratos_timesheet_config` → `contracts.revisores_faturamento_config` (um para muitos)
- `people.colaboradores` → `contracts.revisores_faturamento_config` (muitos para um)
- `contracts.contratos` → `contracts.contratos_indicacoes_config` (um para um)
- `people.colaboradores` → `contracts.contratos_indicacoes_config` (muitos para um)
- `contracts.contratos` → `finance.faturamentos` (um para muitos)
- `core.tenants` → `contracts.produtos` (um para muitos)
- `core.tenants` → `contracts.contratos` (um para muitos)
