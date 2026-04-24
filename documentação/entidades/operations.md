# Schema `operations`

## Objetivo

Registrar a **execução operacional** do trabalho: timesheets, despesas, prestadores de serviço e parceiros.

---

## 1. Timesheets

**Tabela**: `operations.timesheets`

Registro de horas trabalhadas por colaborador em casos específicos.

**Campos**:
- `id` (UUID, PK) - Identificador único
- `tenant_id` (UUID, FK -> core.tenants.id, NOT NULL) - Tenant
- `colaborador_id` (UUID, FK -> people.colaboradores.id, NOT NULL) - Colaborador
- `caso_id` (UUID, FK -> contracts.casos.id, NOT NULL) - Caso
- `data` (DATE, NOT NULL) - Data do apontamento
- `horas` (DECIMAL(4,2), NOT NULL) - Quantidade de horas trabalhadas
- `descricao` (TEXT) - Descrição do trabalho realizado
- `valor_hora` (DECIMAL(10,2)) - Valor da hora aplicado
- `valor_total` (DECIMAL(10,2)) - Valor total (horas * valor_hora)
- `status` (ENUM, NOT NULL) - Status: rascunho, enviado, aprovado, em_revisao_faturamento
- `faturado` (BOOLEAN, DEFAULT false) - Indica se já foi faturado
- `revisor_id` (UUID, FK -> people.colaboradores.id) - Revisor
- `aprovador_id` (UUID, FK -> people.colaboradores.id) - Aprovador
- `data_aprovacao` (DATE) - Data de aprovação
- `observacoes` (TEXT) - Observações do revisor/aprovador
- `created_at` (TIMESTAMPTZ) - Data de criação
- `updated_at` (TIMESTAMPTZ) - Data de atualização
- `created_by` (UUID, FK -> auth.users.id) - Usuário que criou
- `updated_by` (UUID, FK -> auth.users.id) - Usuário que atualizou

**Relacionamentos**:
- Pertence a: COLABORADOR (muitos para um) → `people.colaboradores`
- Pertence a: CASO (muitos para um) → `contracts.casos`
- Relacionado com: COLABORADOR (revisor, muitos para um) → `people.colaboradores`
- Relacionado com: COLABORADOR (aprovador, muitos para um) → `people.colaboradores`
- Relacionado com: ITENS DE FATURAMENTO (um para muitos) → `finance.itens_faturamento`

**Regras de Negócio**:
- Valor da hora pode variar conforme regras financeiras do caso
- Status segue fluxo: rascunho -> enviado -> aprovado (automático)
- Status `em_revisao_faturamento` quando incluído em faturamento em revisão
- **Não há revisão separada de timesheet** - revisão ocorre apenas durante revisão do faturamento
- Valor total calculado automaticamente
- **Pode ser editado até faturamento entrar em revisão** (status "em_revisao")
- Pode ser editado se faturamento estiver em "rascunho" ou "enviado_revisao"
- **NÃO pode ser editado** se faturamento estiver em "em_revisao" ou superior (apenas revisores podem editar)
- Pode ser editado durante revisão do faturamento por revisores (atualiza valor_revisado do item)
- Campo `faturado` indica se já foi incluído em algum faturamento
- Sócio e Administrativo podem lançar timesheets para qualquer colaborador
- Advogado pode lançar timesheets apenas para si mesmo
- Estagiário pode lançar timesheets apenas para si mesmo

**Índices**:
- `idx_timesheet_tenant` (tenant_id)
- `idx_timesheet_colaborador` (colaborador_id)
- `idx_timesheet_caso` (caso_id)
- `idx_timesheet_data` (data)
- `idx_timesheet_status` (status)
- `idx_timesheet_faturado` (faturado)

---

## 2. Despesas

**Tabela**: `operations.despesas`

Registro de despesas reembolsáveis e não reembolsáveis.

**Campos**:
- `id` (UUID, PK) - Identificador único
- `tenant_id` (UUID, FK -> core.tenants.id, NOT NULL) - Tenant
- `caso_id` (UUID, FK -> contracts.casos.id) - Caso relacionado (se reembolsável)
- `prestador_servico_id` (UUID, FK -> operations.prestadores_servico.id) - Prestador de serviço
- `tipo` (ENUM, NOT NULL) - Tipo: reembolsavel, nao_reembolsavel
- `descricao` (VARCHAR, NOT NULL) - Descrição da despesa
- `valor` (DECIMAL(10,2), NOT NULL) - Valor da despesa
- `data_despesa` (DATE, NOT NULL) - Data da despesa
- `data_vencimento` (DATE) - Data de vencimento (se aplicável)
- `status` (ENUM, NOT NULL) - Status: pendente, pago, cancelado
- `nota_fiscal_id` (UUID, FK -> finance.notas_fiscais.id) - Nota fiscal relacionada
- `created_at` (TIMESTAMPTZ) - Data de criação
- `updated_at` (TIMESTAMPTZ) - Data de atualização
- `created_by` (UUID, FK -> auth.users.id) - Usuário que criou
- `updated_by` (UUID, FK -> auth.users.id) - Usuário que atualizou

**Relacionamentos**:
- Pertence a: CASO (muitos para um, se reembolsável) → `contracts.casos`
- Relacionado com: PRESTADOR DE SERVIÇO (muitos para um)
- Relacionado com: PAGAMENTOS (um para muitos) → `finance.pagamentos`
- Relacionado com: FATURAMENTOS (muitos para muitos) via `finance.itens_faturamento`
- Relacionado com: NOTA FISCAL (muitos para um) → `finance.notas_fiscais`

**Regras de Negócio**:
- Despesas reembolsáveis devem estar vinculadas a um caso
- Despesas não reembolsáveis são despesas internas da empresa

**Índices**:
- `idx_despesas_tenant` (tenant_id)
- `idx_despesas_caso` (caso_id)
- `idx_despesas_status` (status)
- `idx_despesas_data` (data_despesa)
- `idx_despesas_prestador` (prestador_servico_id)

---

## 3. Prestadores de Serviço

**Tabela**: `operations.prestadores_servico`

Cadastro de fornecedores externos de serviços.

**Campos**:
- `id` (UUID, PK) - Identificador único
- `tenant_id` (UUID, FK -> core.tenants.id, NOT NULL) - Tenant
- `servico_recorrente` (BOOLEAN, DEFAULT false) - Indica se o serviço é recorrente
- `valor_recorrente` (DECIMAL(10,2)) - Valor do serviço recorrente (obrigatório se servico_recorrente = true)
- `nome_prestador` (VARCHAR, NOT NULL) - Nome do prestador
- `categoria_servico_id` (UUID, FK -> operations.categorias_servico.id) - Categoria do serviço
- `cpf_cnpj` (VARCHAR(14), NOT NULL) - CPF ou CNPJ
- `tipo_documento` (ENUM, NOT NULL) - Tipo: cpf, cnpj
- `rua` (VARCHAR) - Logradouro
- `numero` (VARCHAR) - Número do endereço
- `complemento` (VARCHAR) - Complemento do endereço
- `cidade` (VARCHAR) - Cidade
- `estado` (VARCHAR(2)) - Estado (UF)
- `created_at` (TIMESTAMPTZ) - Data de criação
- `updated_at` (TIMESTAMPTZ) - Data de atualização
- `created_by` (UUID, FK -> auth.users.id) - Usuário que criou
- `updated_by` (UUID, FK -> auth.users.id) - Usuário que atualizou

**Tabelas Relacionadas**:
- `operations.prestadores_responsaveis_internos` - Responsável interno
- `operations.prestadores_dados_bancarios` - Dados bancários

**Relacionamentos**:
- Pertence a: CATEGORIA DE SERVIÇOS (muitos para um)
- Possui: RESPONSÁVEL INTERNO (um para um, opcional)
- Possui: DADOS BANCÁRIOS (um para um)
- Relacionado com: DESPESAS (um para muitos)

**Regras de Negócio**:
- Valor recorrente obrigatório se serviço for recorrente
- CPF/CNPJ deve ser válido conforme tipo_documento
- CPF/CNPJ deve ser único por tenant
- Categorias possíveis: Tecnologia, Consultoria, Marketing, etc.

**Índices**:
- `idx_prestadores_tenant` (tenant_id)
- `idx_prestadores_cpf_cnpj` (tenant_id, cpf_cnpj) UNIQUE
- `idx_prestadores_nome` (tenant_id, nome_prestador)
- `idx_prestadores_categoria` (categoria_servico_id)

---

## 4. Categorias de Serviço

**Tabela**: `operations.categorias_servico`

Categorização dos serviços prestados.

**Campos**:
- `id` (UUID, PK) - Identificador único
- `tenant_id` (UUID, FK -> core.tenants.id, NOT NULL) - Tenant
- `nome` (VARCHAR, NOT NULL) - Nome da categoria
- `created_at` (TIMESTAMPTZ) - Data de criação
- `updated_at` (TIMESTAMPTZ) - Data de atualização
- `created_by` (UUID, FK -> auth.users.id) - Usuário que criou
- `updated_by` (UUID, FK -> auth.users.id) - Usuário que atualizou

**Relacionamentos**:
- Relacionado com: PRESTADORES DE SERVIÇO (um para muitos)

**Regras de Negócio**:
- Nome deve ser único por tenant

**Índices**:
- `idx_categorias_servico_tenant` (tenant_id)
- `idx_categorias_servico_nome` (tenant_id, nome) UNIQUE

---

## 5. Responsáveis Internos (Prestadores)

**Tabela**: `operations.prestadores_responsaveis_internos`

Responsável interno do prestador de serviço.

**Campos**:
- `id` (UUID, PK) - Identificador único
- `prestador_id` (UUID, FK -> operations.prestadores_servico.id, NOT NULL, UNIQUE) - Prestador
- `nome` (VARCHAR, NOT NULL) - Nome do responsável
- `email` (VARCHAR) - E-mail
- `whatsapp` (VARCHAR) - WhatsApp
- `created_at` (TIMESTAMPTZ) - Data de criação
- `updated_at` (TIMESTAMPTZ) - Data de atualização

**Relacionamentos**:
- Pertence a: PRESTADOR DE SERVIÇO (um para um)

**Índices**:
- `idx_prestadores_responsaveis_prestador` (prestador_id) UNIQUE

---

## 6. Dados Bancários (Prestadores)

**Tabela**: `operations.prestadores_dados_bancarios`

Dados bancários do prestador de serviço.

**Campos**:
- `id` (UUID, PK) - Identificador único
- `prestador_id` (UUID, FK -> operations.prestadores_servico.id, NOT NULL, UNIQUE) - Prestador
- `banco` (VARCHAR, NOT NULL) - Nome do banco
- `conta_com_digito` (VARCHAR, NOT NULL) - Conta com dígito
- `agencia` (VARCHAR, NOT NULL) - Agência
- `chave_pix` (VARCHAR) - Chave PIX
- `created_at` (TIMESTAMPTZ) - Data de criação
- `updated_at` (TIMESTAMPTZ) - Data de atualização

**Relacionamentos**:
- Pertence a: PRESTADOR DE SERVIÇO (um para um)

**Índices**:
- `idx_prestadores_dados_bancarios_prestador` (prestador_id) UNIQUE

---

## 7. Parceiros

**Tabela**: `operations.parceiros`

Cadastro de escritórios de advocacia parceiros.

**Campos**:
- `id` (UUID, PK) - Identificador único
- `tenant_id` (UUID, FK -> core.tenants.id, NOT NULL) - Tenant
- `nome_escritorio` (VARCHAR, NOT NULL) - Nome do escritório
- `cnpj` (VARCHAR(14), NOT NULL) - CNPJ
- `rua` (VARCHAR) - Logradouro
- `numero` (VARCHAR) - Número do endereço
- `complemento` (VARCHAR) - Complemento do endereço
- `cidade` (VARCHAR) - Cidade
- `estado` (VARCHAR(2)) - Estado (UF)
- `created_at` (TIMESTAMPTZ) - Data de criação
- `updated_at` (TIMESTAMPTZ) - Data de atualização
- `created_by` (UUID, FK -> auth.users.id) - Usuário que criou
- `updated_by` (UUID, FK -> auth.users.id) - Usuário que atualizou

**Tabelas Relacionadas**:
- `operations.parceiros_advogados_responsaveis` - Advogado responsável
- `operations.parceiros_responsaveis_financeiros` - Responsável financeiro
- `operations.parceiros_dados_bancarios` - Dados bancários

**Relacionamentos**:
- Possui: ADVOGADO RESPONSÁVEL (um para um)
- Possui: RESPONSÁVEL FINANCEIRO (um para um)
- Possui: DADOS BANCÁRIOS (um para um)
- Relacionado com: PAGAMENTOS (um para muitos) → `finance.pagamentos`

**Regras de Negócio**:
- CNPJ deve ser único por tenant e válido
- OAB obrigatório para advogado responsável

**Índices**:
- `idx_parceiros_tenant` (tenant_id)
- `idx_parceiros_cnpj` (tenant_id, cnpj) UNIQUE
- `idx_parceiros_nome` (tenant_id, nome_escritorio)

---

## 8. Advogados Responsáveis (Parceiros)

**Tabela**: `operations.parceiros_advogados_responsaveis`

Advogado responsável do parceiro.

**Campos**:
- `id` (UUID, PK) - Identificador único
- `parceiro_id` (UUID, FK -> operations.parceiros.id, NOT NULL, UNIQUE) - Parceiro
- `nome` (VARCHAR, NOT NULL) - Nome do advogado
- `email` (VARCHAR) - E-mail
- `oab` (VARCHAR, NOT NULL) - Número OAB
- `cpf` (VARCHAR(11), NOT NULL) - CPF
- `whatsapp` (VARCHAR) - WhatsApp
- `created_at` (TIMESTAMPTZ) - Data de criação
- `updated_at` (TIMESTAMPTZ) - Data de atualização

**Relacionamentos**:
- Pertence a: PARCEIRO (um para um)

**Índices**:
- `idx_parceiros_advogados_parceiro` (parceiro_id) UNIQUE

---

## 9. Responsáveis Financeiros (Parceiros)

**Tabela**: `operations.parceiros_responsaveis_financeiros`

Responsável financeiro do parceiro.

**Campos**:
- `id` (UUID, PK) - Identificador único
- `parceiro_id` (UUID, FK -> operations.parceiros.id, NOT NULL, UNIQUE) - Parceiro
- `nome` (VARCHAR, NOT NULL) - Nome do responsável
- `email` (VARCHAR) - E-mail
- `whatsapp` (VARCHAR) - WhatsApp
- `created_at` (TIMESTAMPTZ) - Data de criação
- `updated_at` (TIMESTAMPTZ) - Data de atualização

**Relacionamentos**:
- Pertence a: PARCEIRO (um para um)

**Índices**:
- `idx_parceiros_responsaveis_financeiros_parceiro` (parceiro_id) UNIQUE

---

## 10. Dados Bancários (Parceiros)

**Tabela**: `operations.parceiros_dados_bancarios`

Dados bancários do parceiro.

**Campos**:
- `id` (UUID, PK) - Identificador único
- `parceiro_id` (UUID, FK -> operations.parceiros.id, NOT NULL, UNIQUE) - Parceiro
- `banco` (VARCHAR, NOT NULL) - Nome do banco
- `conta_com_digito` (VARCHAR, NOT NULL) - Conta com dígito
- `agencia` (VARCHAR, NOT NULL) - Agência
- `chave_pix` (VARCHAR) - Chave PIX
- `created_at` (TIMESTAMPTZ) - Data de criação
- `updated_at` (TIMESTAMPTZ) - Data de atualização

**Relacionamentos**:
- Pertence a: PARCEIRO (um para um)

**Índices**:
- `idx_parceiros_dados_bancarios_parceiro` (parceiro_id) UNIQUE

---

## Relacionamentos

- `people.colaboradores` → `operations.timesheets` (um para muitos)
- `contracts.casos` → `operations.timesheets` (um para muitos)
- `contracts.casos` → `operations.despesas` (um para muitos)
- `operations.prestadores_servico` → `operations.despesas` (um para muitos)
- `operations.categorias_servico` → `operations.prestadores_servico` (um para muitos)
- `operations.prestadores_servico` → `operations.prestadores_responsaveis_internos` (um para um)
- `operations.prestadores_servico` → `operations.prestadores_dados_bancarios` (um para um)
- `operations.parceiros` → `operations.parceiros_advogados_responsaveis` (um para um)
- `operations.parceiros` → `operations.parceiros_responsaveis_financeiros` (um para um)
- `operations.parceiros` → `operations.parceiros_dados_bancarios` (um para um)
- `operations.timesheets` → `finance.itens_faturamento` (um para muitos)
- `operations.despesas` → `finance.pagamentos` (um para muitos)
- `core.tenants` → `operations.timesheets` (um para muitos)
- `core.tenants` → `operations.despesas` (um para muitos)
- `core.tenants` → `operations.prestadores_servico` (um para muitos)
- `core.tenants` → `operations.categorias_servico` (um para muitos)
- `core.tenants` → `operations.parceiros` (um para muitos)
