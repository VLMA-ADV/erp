# Schema `documents`

## Objetivo

Gestão eletrônica de documentos (GED) e templates de e-mail.

---

## 1. Documentos / GED

**Tabela**: `documents.documentos`

Sistema de gestão eletrônica de documentos.

**Campos**:
- `id` (UUID, PK) - Identificador único
- `tenant_id` (UUID, FK -> core.tenants.id, NOT NULL) - Tenant
- `nome` (VARCHAR, NOT NULL) - Nome do documento
- `tipo` (ENUM) - Tipo: proposta, contrato, nota_fiscal, invoice, outros
- `tipo_entidade` (ENUM) - Tipo da entidade relacionada: contrato, proposta, nota_fiscal, etc.
- `entidade_id` (UUID, NOT NULL) - ID da entidade relacionada (polimórfico)
- `caminho_arquivo` (VARCHAR, NOT NULL) - Caminho do arquivo no storage
- `tamanho` (BIGINT) - Tamanho do arquivo em bytes
- `mime_type` (VARCHAR) - Tipo MIME do arquivo
- `versao` (INTEGER, DEFAULT 1) - Versão do documento
- `ativo` (BOOLEAN, DEFAULT true) - Indica se está ativo
- `created_at` (TIMESTAMPTZ) - Data de criação
- `updated_at` (TIMESTAMPTZ) - Data de atualização
- `created_by` (UUID, FK -> auth.users.id) - Usuário que criou
- `updated_by` (UUID, FK -> auth.users.id) - Usuário que atualizou

**Relacionamentos**:
- Relacionado com: CONTRATOS, NOTAS FISCAIS (polimórfico)
- Relacionado com: CONTRATOS (proposta_anexo) → `contracts.contratos`
- Relacionado com: NOTAS FISCAIS (anexo) → `finance.notas_fiscais`

**Regras de Negócio**:
- Suporta versionamento de documentos
- Arquivos devem ser armazenados em storage seguro (ex: Supabase Storage)
- Tipo de entidade deve seguir formato `schema.tabela` (ex: `contracts.contratos`, `finance.notas_fiscais`)

**Índices**:
- `idx_documentos_tenant` (tenant_id)
- `idx_documentos_tipo_entidade` (tenant_id, tipo_entidade, entidade_id)
- `idx_documentos_tipo` (tipo)

---

## 2. Templates de E-mail

**Tabela**: `documents.templates_email`

Templates de e-mail para envio de cobranças e outras comunicações.

**Campos**:
- `id` (UUID, PK) - Identificador único
- `tenant_id` (UUID, FK -> core.tenants.id, NOT NULL) - Tenant
- `nome` (VARCHAR, NOT NULL) - Nome do template
- `assunto` (VARCHAR, NOT NULL) - Assunto do e-mail
- `corpo` (TEXT, NOT NULL) - Corpo do e-mail (HTML ou texto)
- `tipo` (ENUM, NOT NULL) - Tipo: cobranca, notificacao, outros
- `variaveis` (JSONB) - Variáveis disponíveis no template (ex: {nome_cliente}, {valor}, {data_vencimento})
- `ativo` (BOOLEAN, DEFAULT true) - Indica se está ativo
- `created_at` (TIMESTAMPTZ) - Data de criação
- `updated_at` (TIMESTAMPTZ) - Data de atualização
- `created_by` (UUID, FK -> auth.users.id) - Usuário que criou
- `updated_by` (UUID, FK -> auth.users.id) - Usuário que atualizou

**Relacionamentos**:
- Relacionado com: COBRANÇAS (um para muitos) → `finance.cobrancas`

**Regras de Negócio**:
- Template deve suportar variáveis dinâmicas
- Variáveis são substituídas no momento do envio
- Corpo pode ser HTML ou texto puro
- Nome deve ser único por tenant

**Índices**:
- `idx_templates_email_tenant` (tenant_id)
- `idx_templates_email_nome` (tenant_id, nome) UNIQUE
- `idx_templates_email_tipo` (tipo)
- `idx_templates_email_ativo` (ativo)

---

## Relacionamentos

- `documents.documentos` → `contracts.contratos` (proposta_anexo, muitos para um)
- `documents.documentos` → `finance.notas_fiscais` (anexo, muitos para um)
- `documents.templates_email` → `finance.cobrancas` (um para muitos)
- `core.tenants` → `documents.documentos` (um para muitos)
- `core.tenants` → `documents.templates_email` (um para muitos)

---

## Observações

### Armazenamento de Arquivos

Os documentos devem ser armazenados no **Supabase Storage** ou serviço similar, seguindo a estrutura:

```
{tenant_id}/{tipo_entidade}/{entidade_id}/{versao}/{nome_arquivo}
```

### Versionamento

O campo `versao` permite rastrear diferentes versões do mesmo documento. Quando um novo documento é criado para a mesma entidade, a versão é incrementada.

### Variáveis de Template

As variáveis disponíveis no template são armazenadas em JSONB e podem incluir:

- `{nome_cliente}` - Nome do cliente
- `{valor}` - Valor da cobrança
- `{data_vencimento}` - Data de vencimento
- `{numero_nota_fiscal}` - Número da nota fiscal
- Outras variáveis específicas do contexto
