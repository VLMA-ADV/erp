# Schema `finance`

## Objetivo

Gerenciar todo o **ciclo financeiro**: faturamentos, notas fiscais, cobranças e pagamentos.

---

## 1. Faturamentos

**Tabela**: `finance.faturamentos`

Faturamento criado pelo financeiro antes da nota fiscal, passando por revisão sequencial de múltiplos revisores antes da geração da NF. Vinculado ao contrato e pode incluir itens de múltiplos casos.

**Campos**:
- `id` (UUID, PK) - Identificador único
- `tenant_id` (UUID, FK -> core.tenants.id, NOT NULL) - Tenant
- `contrato_id` (UUID, FK -> contracts.contratos.id, NOT NULL) - Contrato relacionado
- `cliente_id` (UUID, FK -> crm.clientes.id, NOT NULL) - Cliente
- `financeiro_id` (UUID, FK -> people.colaboradores.id, NOT NULL) - Colaborador do financeiro que criou/enviou para revisão
- `periodo_inicio` (DATE, NOT NULL) - Início do período de faturamento
- `periodo_fim` (DATE, NOT NULL) - Fim do período de faturamento
- `valor_bruto` (DECIMAL(10,2), NOT NULL) - Valor bruto calculado (soma dos itens)
- `valor_liquido` (DECIMAL(10,2)) - Valor líquido (após impostos, calculado após revisão completa)
- `regime_pagamento` (VARCHAR) - Regime de pagamento (impostos aplicados)
- `status` (ENUM, NOT NULL) - Status: rascunho, enviado_revisao, em_revisao, revisao_completa, aprovado, rejeitado, nota_gerada
- `nota_fiscal_id` (UUID, FK -> finance.notas_fiscais.id) - Nota fiscal gerada (se aprovado)
- `observacoes` (TEXT) - Observações gerais
- `created_at` (TIMESTAMPTZ) - Data de criação
- `updated_at` (TIMESTAMPTZ) - Data de atualização
- `created_by` (UUID, FK -> auth.users.id) - Usuário que criou
- `updated_by` (UUID, FK -> auth.users.id) - Usuário que atualizou

**Tabelas Relacionadas**:
- `finance.faturamentos_casos` - Casos incluídos no faturamento
- `finance.itens_faturamento` - Itens que compõem o faturamento (timesheets, pagamentos únicos/recorrentes)
- `finance.revisores_faturamento` - Revisores do faturamento com ordem sequencial

**Relacionamentos**:
- Pertence a: CONTRATO (muitos para um) → `contracts.contratos`
- Pertence a: CLIENTE (muitos para um) → `crm.clientes`
- Possui: CASOS (muitos para muitos) via `finance.faturamentos_casos`
- Possui: ITENS DE FATURAMENTO (um para muitos)
- Possui: REVISORES DE FATURAMENTO (um para muitos)
- Relacionado com: COLABORADOR (financeiro, muitos para um) → `people.colaboradores`
- Relacionado com: NOTA FISCAL (um para um, quando aprovado)

**Regras de Negócio**:
- Faturamento é criado pelo financeiro selecionando itens em aberto do contrato
- Pode incluir itens de múltiplos casos do mesmo contrato
- Itens disponíveis: timesheets não faturados, pagamentos únicos/recorrentes não faturados (consolidados via API)
- Status segue fluxo: rascunho -> enviado_revisao -> em_revisao -> revisao_completa -> aprovado/rejeitado -> nota_gerada
- Todos os revisores devem aprovar sequencialmente antes de status mudar para `revisao_completa`
- Revisores podem alterar timesheets durante revisão (atualiza valor do item de faturamento)
- Revisores veem contrato e casos, podem revisar por caso
- Quando `revisao_completa`, volta para financeiro gerar NF, boleto e e-mail
- Valor líquido calculado após revisão completa baseado no regime de pagamento
- Pagamentos únicos/recorrentes são consolidados via API das regras financeiras (não há tabela específica)

**Índices**:
- `idx_faturamentos_tenant` (tenant_id)
- `idx_faturamentos_contrato` (contrato_id)
- `idx_faturamentos_cliente` (cliente_id)
- `idx_faturamentos_financeiro` (financeiro_id)
- `idx_faturamentos_status` (status)
- `idx_faturamentos_periodo` (periodo_inicio, periodo_fim)

---

## 2. Faturamentos Casos (Junction Table)

**Tabela**: `finance.faturamentos_casos`

Casos incluídos no faturamento.

**Campos**:
- `id` (UUID, PK) - Identificador único
- `faturamento_id` (UUID, FK -> finance.faturamentos.id, NOT NULL) - Faturamento
- `caso_id` (UUID, FK -> contracts.casos.id, NOT NULL) - Caso
- `created_at` (TIMESTAMPTZ) - Data de criação

**Regras de Negócio**:
- Combinação faturamento_id + caso_id deve ser única

**Índices**:
- `idx_faturamentos_casos_faturamento` (faturamento_id)
- `idx_faturamentos_casos_caso` (caso_id)
- `idx_faturamentos_casos_unique` (faturamento_id, caso_id) UNIQUE

---

## 3. Itens de Faturamento

**Tabela**: `finance.itens_faturamento`

Itens que compõem o faturamento (timesheets, pagamentos únicos, pagamentos recorrentes). Permite alteração de valores durante revisão.

**Campos**:
- `id` (UUID, PK) - Identificador único
- `faturamento_id` (UUID, FK -> finance.faturamentos.id, NOT NULL) - Faturamento
- `tipo_item` (ENUM, NOT NULL) - Tipo: timesheet, pagamento_unico, pagamento_recorrente
- `item_tipo` (VARCHAR, NOT NULL) - Tipo da entidade relacionada (polimórfico)
- `item_id` (UUID, NOT NULL) - ID do item relacionado (polimórfico)
- `caso_id` (UUID, FK -> contracts.casos.id) - Caso relacionado (se aplicável)
- `descricao` (VARCHAR) - Descrição do item
- `valor_original` (DECIMAL(10,2), NOT NULL) - Valor original do item
- `valor_revisado` (DECIMAL(10,2)) - Valor após revisão (pode ser alterado pelos revisores)
- `valor_final` (DECIMAL(10,2), NOT NULL) - Valor final usado no faturamento (valor_revisado ou valor_original)
- `observacoes` (TEXT) - Observações sobre alterações na revisão
- `created_at` (TIMESTAMPTZ) - Data de criação
- `updated_at` (TIMESTAMPTZ) - Data de atualização
- `updated_by` (UUID, FK -> auth.users.id) - Usuário que atualizou (revisor)

**Relacionamentos**:
- Pertence a: FATURAMENTO (muitos para um)
- Relacionado com: CASO (muitos para um, se aplicável) → `contracts.casos`
- Relacionado com: TIMESHEET, PAGAMENTO ÚNICO, PAGAMENTO RECORRENTE (polimórfico)

**Regras de Negócio**:
- Tipos possíveis: timesheet, pagamento_unico, pagamento_recorrente
- Valor original é o valor inicial do item
- Revisores podem alterar valor_revisado durante revisão
- Valor final = valor_revisado (se existir) ou valor_original
- Alterações em timesheets durante revisão atualizam valor_revisado do item
- Pagamentos únicos/recorrentes são consolidados via API (não há tabela específica)

**Índices**:
- `idx_itens_faturamento_faturamento` (faturamento_id)
- `idx_itens_faturamento_tipo` (tipo_item)
- `idx_itens_faturamento_item` (item_tipo, item_id)
- `idx_itens_faturamento_caso` (caso_id)

---

## 4. Revisores de Faturamento

**Tabela**: `finance.revisores_faturamento`

Revisores do faturamento com ordem sequencial de aprovação. Todos devem aprovar antes de gerar a NF.

**Campos**:
- `id` (UUID, PK) - Identificador único
- `faturamento_id` (UUID, FK -> finance.faturamentos.id, NOT NULL) - Faturamento
- `colaborador_id` (UUID, FK -> people.colaboradores.id, NOT NULL) - Revisor (sócio)
- `ordem` (INTEGER, NOT NULL) - Ordem de revisão (1 = primário, 2 = secundário, etc.)
- `status` (ENUM, NOT NULL) - Status: pendente, em_revisao, aprovado, rejeitado
- `data_inicio_revisao` (TIMESTAMPTZ) - Data/hora de início da revisão
- `data_aprovacao` (TIMESTAMPTZ) - Data/hora de aprovação/rejeição
- `observacoes` (TEXT) - Observações do revisor
- `created_at` (TIMESTAMPTZ) - Data de criação
- `updated_at` (TIMESTAMPTZ) - Data de atualização

**Relacionamentos**:
- Pertence a: FATURAMENTO (muitos para um)
- Relacionado com: COLABORADOR (muitos para um) → `people.colaboradores`

**Regras de Negócio**:
- Ordem deve ser única por faturamento
- Revisores devem ser sócios (categoria = "sócio")
- Revisão ocorre sequencialmente conforme ordem
- Revisor só pode revisar quando todos os anteriores aprovaram
- Status "em_revisao" quando é a vez do revisor revisar
- Todos os revisores devem aprovar antes de status do faturamento mudar para `revisao_completa`
- Revisores podem alterar timesheets durante revisão

**Índices**:
- `idx_revisores_faturamento_faturamento` (faturamento_id)
- `idx_revisores_faturamento_ordem` (faturamento_id, ordem) UNIQUE
- `idx_revisores_faturamento_status` (status)

---

## 5. Notas Fiscais / Invoices

**Tabela**: `finance.notas_fiscais`

Emissão e controle de documentos fiscais (NF e Invoices). Geradas a partir de faturamentos aprovados.

**Campos**:
- `id` (UUID, PK) - Identificador único
- `tenant_id` (UUID, FK -> core.tenants.id, NOT NULL) - Tenant
- `faturamento_id` (UUID, FK -> finance.faturamentos.id, NOT NULL, UNIQUE) - Faturamento que gerou a NF
- `tipo` (ENUM, NOT NULL) - Tipo: nota_fiscal, invoice
- `numero` (VARCHAR, NOT NULL) - Número do documento
- `serie` (VARCHAR) - Série (para NF)
- `caso_id` (UUID, FK -> contracts.casos.id, NOT NULL) - Caso relacionado
- `cliente_id` (UUID, FK -> crm.clientes.id, NOT NULL) - Cliente
- `valor_bruto` (DECIMAL(10,2), NOT NULL) - Valor bruto
- `valor_liquido` (DECIMAL(10,2), NOT NULL) - Valor líquido (após impostos)
- `data_emissao` (DATE, NOT NULL) - Data de emissão
- `data_vencimento` (DATE) - Data de vencimento
- `status` (ENUM, NOT NULL) - Status: rascunho, emitida, cancelada, paga
- `regime_pagamento` (VARCHAR) - Regime de pagamento (impostos aplicados)
- `anexo_id` (UUID, FK -> documents.documentos.id) - Anexo do documento (GED)
- `observacoes` (TEXT) - Observações
- `created_at` (TIMESTAMPTZ) - Data de criação
- `updated_at` (TIMESTAMPTZ) - Data de atualização
- `created_by` (UUID, FK -> auth.users.id) - Usuário que criou
- `updated_by` (UUID, FK -> auth.users.id) - Usuário que atualizou

**Relacionamentos**:
- Pertence a: FATURAMENTO (um para um)
- Pertence a: CASO (muitos para um) → `contracts.casos`
- Pertence a: CLIENTE (muitos para um) → `crm.clientes`
- Possui: PAGAMENTOS (um para muitos)
- Possui: COBRANÇAS (um para muitos)
- Relacionado com: DOCUMENTOS (anexo, muitos para um) → `documents.documentos`

**Regras de Negócio**:
- Nota fiscal é gerada a partir de um faturamento aprovado
- Valor líquido calculado automaticamente baseado no regime de pagamento
- Número deve ser único por tipo e tenant
- Status "paga" quando todos os pagamentos relacionados estão confirmados

**Índices**:
- `idx_notas_fiscais_tenant` (tenant_id)
- `idx_notas_fiscais_faturamento` (faturamento_id) UNIQUE
- `idx_notas_fiscais_numero` (tenant_id, tipo, numero) UNIQUE
- `idx_notas_fiscais_caso` (caso_id)
- `idx_notas_fiscais_cliente` (cliente_id)
- `idx_notas_fiscais_status` (status)

---

## 6. Cobranças

**Tabela**: `finance.cobrancas`

Cobrança que centraliza boleto de pagamento, nota fiscal e mensagem de e-mail enviada ao cliente. Status atualizado automaticamente quando pagamento é recebido.

**Campos**:
- `id` (UUID, PK) - Identificador único
- `tenant_id` (UUID, FK -> core.tenants.id, NOT NULL) - Tenant
- `nota_fiscal_id` (UUID, FK -> finance.notas_fiscais.id, NOT NULL) - Nota fiscal relacionada
- `cliente_id` (UUID, FK -> crm.clientes.id, NOT NULL) - Cliente
- `template_email_id` (UUID, FK -> documents.templates_email.id) - Template de e-mail utilizado
- `valor` (DECIMAL(10,2), NOT NULL) - Valor da cobrança
- `data_vencimento` (DATE, NOT NULL) - Data de vencimento
- `boleto_codigo_barras` (VARCHAR) - Código de barras do boleto
- `boleto_linha_digitavel` (VARCHAR) - Linha digitável do boleto
- `boleto_url` (VARCHAR) - URL do boleto para visualização/download
- `email_enviado` (BOOLEAN, DEFAULT false) - Indica se o e-mail foi enviado
- `data_envio_email` (TIMESTAMPTZ) - Data/hora do envio do e-mail
- `email_destinatario` (VARCHAR) - E-mail do destinatário
- `status` (ENUM, NOT NULL) - Status: pendente, enviada, visualizada, paga, vencida
- `observacoes` (TEXT) - Observações
- `created_at` (TIMESTAMPTZ) - Data de criação
- `updated_at` (TIMESTAMPTZ) - Data de atualização
- `created_by` (UUID, FK -> auth.users.id) - Usuário que criou
- `updated_by` (UUID, FK -> auth.users.id) - Usuário que atualizou

**Relacionamentos**:
- Pertence a: NOTA FISCAL (muitos para um) → `finance.notas_fiscais`
- Pertence a: CLIENTE (muitos para um) → `crm.clientes`
- Possui: PAGAMENTOS (um para muitos)
- Relacionado com: TEMPLATE DE E-MAIL (muitos para um) → `documents.templates_email`

**Regras de Negócio**:
- Cobrança centraliza boleto, nota fiscal e e-mail
- Cobrança é criada após a emissão da nota fiscal
- Deve incluir boleto de pagamento gerado
- E-mail é enviado ao cliente com template configurado
- Status "vencida" calculado automaticamente se data_vencimento < hoje e status != "paga"
- **Status "paga" atualizado automaticamente quando pagamento relacionado for confirmado**
- Quando um pagamento vinculado à cobrança tiver status "confirmado", o status da cobrança muda para "paga"

**Índices**:
- `idx_cobrancas_tenant` (tenant_id)
- `idx_cobrancas_nota_fiscal` (nota_fiscal_id)
- `idx_cobrancas_cliente` (cliente_id)
- `idx_cobrancas_status` (status)
- `idx_cobrancas_vencimento` (data_vencimento)

---

## 7. Pagamentos

**Tabela**: `finance.pagamentos`

Controle de pagamentos recebidos (de clientes) e realizados (para fornecedores/colaboradores).

**Campos**:
- `id` (UUID, PK) - Identificador único
- `tenant_id` (UUID, FK -> core.tenants.id, NOT NULL) - Tenant
- `tipo` (ENUM, NOT NULL) - Tipo: recebido, realizado
- `origem_tipo` (ENUM, NOT NULL) - Origem: cliente, prestador_servico, colaborador, parceiro
- `origem_id` (UUID, NOT NULL) - ID da origem (polimórfico)
- `valor` (DECIMAL(10,2), NOT NULL) - Valor do pagamento
- `data_pagamento` (DATE, NOT NULL) - Data do pagamento
- `data_vencimento` (DATE) - Data de vencimento
- `forma_pagamento` (ENUM, NOT NULL) - Forma: pix, transferencia, boleto, dinheiro, cheque
- `status` (ENUM, NOT NULL) - Status: pendente, confirmado, cancelado, atrasado
- `nota_fiscal_id` (UUID, FK -> finance.notas_fiscais.id) - Nota fiscal relacionada (se recebido)
- `cobranca_id` (UUID, FK -> finance.cobrancas.id) - Cobrança relacionada (se recebido)
- `despesa_id` (UUID, FK -> operations.despesas.id) - Despesa relacionada (se realizado)
- `observacoes` (TEXT) - Observações
- `created_at` (TIMESTAMPTZ) - Data de criação
- `updated_at` (TIMESTAMPTZ) - Data de atualização
- `created_by` (UUID, FK -> auth.users.id) - Usuário que criou
- `updated_by` (UUID, FK -> auth.users.id) - Usuário que atualizou

**Relacionamentos**:
- Relacionado com: NOTA FISCAL (muitos para um) → `finance.notas_fiscais`
- Relacionado com: DESPESA (muitos para um) → `operations.despesas`
- Relacionado com: COBRANÇA (muitos para um) → `finance.cobrancas`
- Relacionado com: CLIENTE, PRESTADOR, COLABORADOR, PARCEIRO (polimórfico)

**Regras de Negócio**:
- Pagamentos recebidos geralmente vinculados a notas fiscais e cobranças
- Pagamentos realizados geralmente vinculados a despesas
- Status "atrasado" calculado automaticamente se data_vencimento < hoje e status = "pendente"
- Quando pagamento vinculado a cobrança for confirmado, atualiza status da cobrança para "paga"
- Quando pagamento vinculado a nota fiscal for confirmado, atualiza status da nota fiscal para "paga" (se todos os pagamentos estiverem confirmados)

**Índices**:
- `idx_pagamentos_tenant` (tenant_id)
- `idx_pagamentos_tipo` (tipo)
- `idx_pagamentos_status` (status)
- `idx_pagamentos_data` (data_pagamento)
- `idx_pagamentos_origem` (origem_tipo, origem_id)
- `idx_pagamentos_cobranca` (cobranca_id)
- `idx_pagamentos_nota_fiscal` (nota_fiscal_id)

---

## 8. Indicações Histórico

**Tabela**: `finance.indicacoes_historico`

Histórico de pagamentos de indicações realizados.

**Campos**:
- `id` (UUID, PK) - Identificador único
- `tenant_id` (UUID, FK -> core.tenants.id, NOT NULL) - Tenant
- `contrato_id` (UUID, FK -> contracts.contratos.id, NOT NULL) - Contrato
- `colaborador_id` (UUID, FK -> people.colaboradores.id, NOT NULL) - Colaborador que recebeu
- `valor` (DECIMAL(10,2), NOT NULL) - Valor pago
- `data_pagamento` (DATE, NOT NULL) - Data do pagamento
- `periodicidade` (ENUM) - Periodicidade: mensal, ao_final, pontual
- `observacoes` (TEXT) - Observações
- `created_at` (TIMESTAMPTZ) - Data de criação
- `created_by` (UUID, FK -> auth.users.id) - Usuário que criou

**Relacionamentos**:
- Pertence a: CONTRATO (muitos para um) → `contracts.contratos`
- Relacionado com: COLABORADOR (muitos para um) → `people.colaboradores`

**Regras de Negócio**:
- Histórico imutável
- Valor pode ser calculado automaticamente conforme configuração do contrato

**Índices**:
- `idx_indicacoes_historico_tenant` (tenant_id)
- `idx_indicacoes_historico_contrato` (contrato_id)
- `idx_indicacoes_historico_colaborador` (colaborador_id)

---

## Relacionamentos

- `contracts.contratos` → `finance.faturamentos` (um para muitos)
- `crm.clientes` → `finance.faturamentos` (muitos para um)
- `people.colaboradores` → `finance.faturamentos` (financeiro, muitos para um)
- `finance.faturamentos` → `finance.faturamentos_casos` (um para muitos)
- `contracts.casos` → `finance.faturamentos_casos` (muitos para um)
- `finance.faturamentos` → `finance.itens_faturamento` (um para muitos)
- `operations.timesheets` → `finance.itens_faturamento` (um para muitos)
- `contracts.casos` → `finance.itens_faturamento` (muitos para um)
- `finance.faturamentos` → `finance.revisores_faturamento` (um para muitos)
- `people.colaboradores` → `finance.revisores_faturamento` (muitos para um)
- `finance.faturamentos` → `finance.notas_fiscais` (um para um)
- `contracts.casos` → `finance.notas_fiscais` (muitos para um)
- `crm.clientes` → `finance.notas_fiscais` (muitos para um)
- `finance.notas_fiscais` → `finance.cobrancas` (um para muitos)
- `crm.clientes` → `finance.cobrancas` (muitos para um)
- `documents.templates_email` → `finance.cobrancas` (muitos para um)
- `finance.cobrancas` → `finance.pagamentos` (um para muitos)
- `finance.notas_fiscais` → `finance.pagamentos` (um para muitos)
- `operations.despesas` → `finance.pagamentos` (um para muitos)
- `contracts.contratos` → `finance.indicacoes_historico` (um para muitos)
- `people.colaboradores` → `finance.indicacoes_historico` (muitos para um)
- `core.tenants` → `finance.faturamentos` (um para muitos)
- `core.tenants` → `finance.notas_fiscais` (um para muitos)
- `core.tenants` → `finance.cobrancas` (um para muitos)
- `core.tenants` → `finance.pagamentos` (um para muitos)
- `core.tenants` → `finance.indicacoes_historico` (um para muitos)
