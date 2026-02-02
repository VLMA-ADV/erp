# Documentação de Telas do Sistema - ERP-VLMA

## Índice

1. [Telas Comuns (Todas as Categorias)](#1-telas-comuns-todas-as-categorias)
2. [Telas para Sócio e Administrativo](#2-telas-para-sócio-e-administrativo)
3. [Telas para Advogado](#3-telas-para-advogado)
4. [Telas para Estagiário](#4-telas-para-estagiário)
5. [Resumo de Acessos por Categoria](#5-resumo-de-acessos-por-categoria)

---

## 1. Telas Comuns (Todas as Categorias)

### 1.1. Tela de Login

**Rota:** `/login`

**Categoria de Acesso:** Todas as categorias

**Descrição:** Tela de autenticação do sistema.

**Campos:**
- `email` (STRING, obrigatório) - Email do colaborador
- `senha` (PASSWORD, obrigatório) - Senha do colaborador
- `lembrar_me` (BOOLEAN, opcional) - Checkbox para manter sessão ativa

**Validações:**
- Email deve ser válido
- Email deve existir no sistema
- Senha deve corresponder ao email
- Conta deve estar ativa

**Ações Disponíveis:**
- Botão "Entrar" - Submete formulário de login
- Link "Esqueci minha senha" - Redireciona para recuperação de senha

**Regras de Negócio:**
- Após login bem-sucedido, redireciona para dashboard conforme categoria
- Sessão expira após período de inatividade (configurável)
- Tentativas de login falhadas são registradas em log

**Fluxos de Navegação:**
- Login bem-sucedido → Dashboard (conforme categoria)
- Login falhado → Mantém na tela de login com mensagem de erro
- Esqueci senha → Tela de recuperação de senha

---

### 1.2. Tela de Recuperação de Senha

**Rota:** `/recuperar-senha`

**Categoria de Acesso:** Todas as categorias

**Descrição:** Permite recuperar senha através de email.

**Campos:**
- `email` (STRING, obrigatório) - Email do colaborador

**Validações:**
- Email deve ser válido
- Email deve existir no sistema

**Ações Disponíveis:**
- Botão "Enviar Link de Recuperação" - Envia email com link
- Link "Voltar para Login" - Retorna para tela de login

**Regras de Negócio:**
- Envia email com link temporário de recuperação
- Link expira em 24 horas
- Link só pode ser usado uma vez

---

### 1.3. Dashboard/Home

**Rota:** `/dashboard`

**Categoria de Acesso:** Todas as categorias (conteúdo varia por categoria)

**Descrição:** Tela principal após login, com informações resumidas e atalhos.

**Componentes (varia por categoria):**

#### Para Sócio e Administrativo:
- Cards de resumo:
  - Total de contratos ativos
  - Faturamentos pendentes de revisão
  - Cobranças vencidas
  - Timesheets pendentes de aprovação
- Gráficos:
  - Faturamento mensal (últimos 6 meses)
  - Distribuição de casos por centro de custo
  - Status de faturamentos
- Lista de ações rápidas:
  - Criar novo contrato
  - Criar novo faturamento
  - Revisar faturamentos pendentes
  - Ver cobranças vencidas
- Notificações:
  - Faturamentos aguardando revisão
  - Cobranças próximas do vencimento
  - Timesheets pendentes

#### Para Advogado:
- Cards de resumo:
  - Meus timesheets do mês
  - Faturamentos aguardando minha revisão
  - Casos onde sou responsável
- Lista de ações rápidas:
  - Lançar timesheet
  - Revisar faturamentos (onde sou revisor)
  - Ver meus timesheets
- Notificações:
  - Faturamentos aguardando minha revisão
  - Lembretes de timesheets pendentes

#### Para Estagiário:
- Cards de resumo:
  - Meus timesheets do mês
  - Casos onde sou responsável
- Lista de ações rápidas:
  - Lançar timesheet
  - Ver meus timesheets
- Notificações:
  - Lembretes de timesheets pendentes

**Ações Disponíveis:**
- Links para módulos principais (conforme permissões)
- Cards clicáveis para acessar funcionalidades específicas
- Filtros de período (quando aplicável)

**Regras de Negócio:**
- Dados são atualizados em tempo real
- Notificações aparecem em destaque
- Ações rápidas são baseadas em permissões do usuário

---

### 1.4. Perfil do Usuário

**Rota:** `/perfil`

**Categoria de Acesso:** Todas as categorias

**Descrição:** Tela para visualizar e editar dados do próprio perfil.

**Campos (Visualização):**
- Nome completo
- Email
- CPF
- Data de nascimento
- Telefone/WhatsApp
- Categoria (sócio, advogado, administrativo, estagiário)
- Cargo
- Área/Centro de custo
- Data de admissão

**Campos (Edição - limitado):**
- Telefone/WhatsApp
- Senha (alteração)
- Foto de perfil (upload)

**Validações:**
- Telefone deve ser válido
- Senha deve ter no mínimo 8 caracteres
- Senha atual deve ser informada para alterar senha

**Ações Disponíveis:**
- Botão "Salvar Alterações" - Salva dados editáveis
- Botão "Alterar Senha" - Abre modal para alteração
- Botão "Upload de Foto" - Permite enviar foto de perfil

**Regras de Negócio:**
- Usuário só pode editar campos permitidos
- Alteração de senha requer senha atual
- Foto de perfil tem limite de tamanho (2MB)

---

## 2. Telas para Sócio e Administrativo

### 2.1. Listagem de Clientes

**Rota:** `/clientes`

**Categoria de Acesso:** Sócio, Administrativo

**Descrição:** Lista todos os clientes cadastrados no sistema.

**Campos na Tabela:**
- Nome
- CNPJ
- Segmento Econômico
- Grupo Econômico
- Status (ativo/inativo)
- Data de cadastro
- Ações (visualizar, editar, deletar)

**Filtros Disponíveis:**
- Busca por nome/CNPJ
- Filtro por segmento econômico
- Filtro por grupo econômico
- Filtro por status

**Ações Disponíveis:**
- Botão "Novo Cliente" - Abre formulário de criação
- Botão "Visualizar" - Abre detalhes do cliente
- Botão "Editar" - Abre formulário de edição
- Botão "Deletar" - Remove cliente (com confirmação)
- Botão "Exportar" - Exporta lista para Excel/PDF

**Validações:**
- Não pode deletar cliente com contratos ativos
- CNPJ deve ser único

**Regras de Negócio:**
- Lista paginada (50 itens por página)
- Ordenação por nome, data de cadastro, etc.
- Exportação inclui todos os filtros aplicados

---

### 2.2. Formulário de Cliente (Criar/Editar)

**Rota:** `/clientes/novo` ou `/clientes/:id/editar`

**Categoria de Acesso:** Sócio, Administrativo

**Descrição:** Formulário para criar ou editar cliente.

**Campos:**

**Dados Básicos:**
- `nome` (STRING, obrigatório) - Nome/Razão Social
- `cliente_estrangeiro` (BOOLEAN) - Checkbox "Cliente Estrangeiro"
- `cnpj` (STRING, condicional) - CNPJ (obrigatório se não for estrangeiro)
- `regime_fiscal` (SELECT, obrigatório) - Regime fiscal

**Endereço:**
- `tipo` (SELECT) - Tipo de endereço
- `rua` (STRING, obrigatório)
- `numero` (STRING, obrigatório)
- `complemento` (STRING, opcional)
- `cidade` (STRING, obrigatório)
- `estado` (SELECT, obrigatório) - UF

**Segmentação:**
- `segmentos_economicos` (MULTISELECT) - Segmentos econômicos (múltiplos)
- `grupo_economico_id` (SELECT, opcional) - Grupo econômico

**Responsável Interno:**
- `responsavel_interno_nome` (STRING, opcional)
- `responsavel_interno_email` (EMAIL, opcional)
- `responsavel_interno_whatsapp` (STRING, opcional)
- `responsavel_interno_data_nascimento` (DATE, opcional)

**Responsável Financeiro:**
- `responsavel_financeiro_nome` (STRING, opcional)
- `responsavel_financeiro_email` (EMAIL, opcional)
- `responsavel_financeiro_whatsapp` (STRING, opcional)

**Outros:**
- `observacoes` (TEXTAREA, opcional) - Observações gerais

**Validações:**
- Nome é obrigatório
- CNPJ é obrigatório se não for estrangeiro
- CNPJ deve ser válido e único
- Email deve ser válido (se informado)
- Estado deve ser válido (UF)

**Ações Disponíveis:**
- Botão "Salvar" - Salva cliente
- Botão "Cancelar" - Volta para listagem
- Botão "Adicionar Responsável" - Adiciona mais responsáveis (múltiplos)

**Regras de Negócio:**
- Cliente estrangeiro não precisa de CNPJ
- Pode ter múltiplos responsáveis internos e financeiros
- Campos de endereço são obrigatórios

---

### 2.3. Detalhes do Cliente

**Rota:** `/clientes/:id`

**Categoria de Acesso:** Sócio, Administrativo

**Descrição:** Visualização detalhada de um cliente.

**Seções:**
1. **Dados Básicos** - Informações principais
2. **Endereço** - Endereço completo
3. **Responsáveis** - Lista de responsáveis internos e financeiros
4. **Contratos** - Lista de contratos do cliente
5. **Histórico** - Log de alterações

**Ações Disponíveis:**
- Botão "Editar" - Abre formulário de edição
- Botão "Novo Contrato" - Cria contrato para este cliente
- Botão "Deletar" - Remove cliente (com confirmação)
- Botão "Exportar" - Exporta dados do cliente

**Regras de Negócio:**
- Mostra todos os contratos vinculados
- Histórico mostra alterações com data e usuário

---

### 2.4. Listagem de Contratos

**Rota:** `/contratos`

**Categoria de Acesso:** Sócio, Administrativo

**Descrição:** Lista todos os contratos cadastrados.

**Campos na Tabela:**
- Nome do Contrato
- Cliente
- Status (ativo/finalizado)
- Data de Início
- Data de Término
- Valor Total (calculado)
- Ações (visualizar, editar, deletar)

**Filtros Disponíveis:**
- Busca por nome/cliente
- Filtro por status
- Filtro por cliente
- Filtro por data

**Ações Disponíveis:**
- Botão "Novo Contrato" - Abre formulário de criação
- Botão "Visualizar" - Abre detalhes do contrato
- Botão "Editar" - Abre formulário de edição
- Botão "Deletar" - Remove contrato (com confirmação)
- Botão "Exportar" - Exporta lista

**Regras de Negócio:**
- Não pode deletar contrato com casos ativos
- Lista paginada

---

### 2.5. Formulário de Contrato (Criar/Editar)

**Rota:** `/contratos/novo` ou `/contratos/:id/editar`

**Categoria de Acesso:** Sócio, Administrativo

**Descrição:** Formulário para criar ou editar contrato.

**Campos:**

**Dados Básicos:**
- `cliente_id` (SELECT, obrigatório) - Cliente
- `nome_contrato` (STRING, obrigatório) - Nome do contrato
- `regime_pagamento` (SELECT, obrigatório) - Regime de pagamento [MEI, SIMPLES NACIONAL, etc.]
- `status` (SELECT, obrigatório) - Status (ativo/finalizado)
- `proposta_anexo_id` (FILE, opcional) - Anexar proposta (GED)

**Ações Disponíveis:**
- Botão "Salvar" - Salva contrato
- Botão "Cancelar" - Volta para listagem
- Botão "Configurar Casos" - Abre seção de casos (após salvar)
- Botão "Configurar Timesheet" - Abre configuração de timesheet
- Botão "Configurar Despesas" - Abre configuração de despesas

**Validações:**
- Cliente é obrigatório
- Nome do contrato é obrigatório
- Regime de pagamento é obrigatório

**Regras de Negócio:**
- Após criar, pode configurar casos, timesheet e despesas
- Proposta pode ser anexada via GED

---

### 2.6. Detalhes do Contrato

**Rota:** `/contratos/:id`

**Categoria de Acesso:** Sócio, Administrativo

**Descrição:** Visualização detalhada de um contrato.

**Abas:**
1. **Geral** - Dados básicos do contrato
2. **Casos** - Lista de casos do contrato
3. **Configurações** - Configurações de timesheet e despesas
4. **Faturamentos** - Lista de faturamentos do contrato
5. **Documentos** - Anexos e documentos

**Ações Disponíveis:**
- Botão "Editar" - Abre formulário de edição
- Botão "Novo Caso" - Cria caso para este contrato
- Botão "Novo Faturamento" - Cria faturamento
- Botão "Configurar Revisores" - Configura revisores de faturamento
- Botão "Adicionar Anexo" - Adiciona documento

**Regras de Negócio:**
- Mostra todos os casos vinculados
- Mostra histórico de faturamentos
- Permite gerenciar configurações

---

### 2.7. Formulário de Caso (Criar/Editar)

**Rota:** `/contratos/:contrato_id/casos/novo` ou `/casos/:id/editar`

**Categoria de Acesso:** Sócio, Administrativo

**Descrição:** Formulário para criar ou editar caso/escopo.

**Campos:**
- `nome` (STRING, obrigatório) - Nome do caso/escopo
- `produto_id` (SELECT, opcional) - Produto relacionado
- `responsavel_id` (SELECT, obrigatório) - Responsável pelo caso
- `centros_custo` (MULTISELECT, obrigatório) - Centros de custo (múltiplos)

**Validações:**
- Nome é obrigatório
- Responsável deve ser colaborador ativo
- Pelo menos um centro de custo deve ser selecionado

**Ações Disponíveis:**
- Botão "Salvar" - Salva caso
- Botão "Cancelar" - Volta para detalhes do contrato
- Botão "Configurar Regras Financeiras" - Abre após salvar

**Regras de Negócio:**
- Após criar, deve configurar regras financeiras
- Centros de custo válidos: Societário, Tributário, Contratos, Trabalhista, Agro, Contencioso Cível

---

### 2.8. Configuração de Regras Financeiras do Caso

**Rota:** `/casos/:id/regras-financeiras`

**Categoria de Acesso:** Sócio, Administrativo

**Descrição:** Configuração das regras financeiras de um caso.

**Campos:**
- `moeda` (SELECT, obrigatório) - Moeda (Real/Câmbio)
- `tipo_nota` (SELECT, obrigatório) - Tipo de nota (Nota Fiscal/Invoice)
- `tipos_cobranca` (MULTISELECT, obrigatório) - Tipos de cobrança (múltiplos):
  - Hora
  - Hora com limite (cap)
  - Mensal
  - Mensalidade de processo
  - Projeto
  - Projeto Parcelado
  - Êxito
- `data_inicio_faturamento` (DATE, obrigatório) - Data de início do faturamento
- `data_pagamento` (DATE, obrigatório) - Data prevista de pagamento
- `data_inicio_proposta` (DATE, opcional) - Data de início da proposta
- `data_reajuste_monetario` (DATE, opcional) - Data do reajuste monetário
- `indice_reajuste` (DECIMAL, opcional) - Índice de reajuste (percentual)

**Validações:**
- Moeda é obrigatória
- Tipo de nota é obrigatório
- Pelo menos um tipo de cobrança deve ser selecionado
- Data de início do faturamento é obrigatória
- Índice de reajuste deve estar entre 0 e 100 (se informado)

**Ações Disponíveis:**
- Botão "Salvar" - Salva regras financeiras
- Botão "Cancelar" - Volta para detalhes do caso

**Regras de Negócio:**
- Múltiplos tipos de cobrança podem ser selecionados
- Índice de reajuste é usado para calcular reajuste da hora

---

### 2.9. Configuração de Timesheet do Contrato

**Rota:** `/contratos/:id/timesheet-config`

**Categoria de Acesso:** Sócio, Administrativo

**Descrição:** Configuração de timesheet e revisores de faturamento para o contrato.

**Campos:**
- `envia_timesheet_cliente` (BOOLEAN) - Checkbox "Enviar timesheet ao cliente?"

**Revisores de Faturamento:**
- Lista de revisores com:
  - `colaborador_id` (SELECT) - Colaborador (sócio, administrativo ou advogado)
  - `ordem` (NUMBER) - Ordem de revisão (1, 2, 3...)
  - Botão "Remover"

**Ações Disponíveis:**
- Botão "Adicionar Revisor" - Adiciona novo revisor
- Botão "Salvar" - Salva configuração
- Botão "Cancelar" - Volta para detalhes do contrato

**Validações:**
- Todos os revisores devem ser sócios, administrativos ou advogados
- Ordem dos revisores deve ser única e sequencial
- Pelo menos um revisor deve ser configurado

**Regras de Negócio:**
- Revisores são para revisão de FATURAMENTO, não de timesheet
- Revisores são processados sequencialmente conforme ordem
- Sócio e Administrativo podem revisar mesmo sem estar configurados

---

### 2.10. Listagem de Timesheets

**Rota:** `/timesheets`

**Categoria de Acesso:** Sócio, Administrativo

**Descrição:** Lista todos os timesheets do sistema.

**Campos na Tabela:**
- Colaborador
- Caso
- Data
- Horas
- Valor Total
- Status
- Faturado
- Ações (visualizar, editar, deletar)

**Filtros Disponíveis:**
- Busca por colaborador/caso
- Filtro por status
- Filtro por caso
- Filtro por colaborador
- Filtro por data
- Filtro por faturado/não faturado

**Ações Disponíveis:**
- Botão "Novo Timesheet" - Abre formulário de criação
- Botão "Visualizar" - Abre detalhes
- Botão "Editar" - Abre formulário de edição
- Botão "Deletar" - Remove timesheet
- Botão "Exportar" - Exporta lista

**Regras de Negócio:**
- Lista paginada
- Pode filtrar por múltiplos critérios
- Sócio/Administrativo pode lançar para qualquer colaborador

---

### 2.11. Formulário de Timesheet (Criar/Editar)

**Rota:** `/timesheets/novo` ou `/timesheets/:id/editar`

**Categoria de Acesso:** Sócio, Administrativo

**Descrição:** Formulário para criar ou editar timesheet.

**Campos:**
- `colaborador_id` (SELECT, obrigatório) - Colaborador (pode selecionar qualquer)
- `caso_id` (SELECT, obrigatório) - Caso
- `data` (DATE, obrigatório) - Data do apontamento
- `horas` (DECIMAL, obrigatório) - Quantidade de horas (0-24)
- `descricao` (TEXTAREA, obrigatório) - Descrição do trabalho

**Campos Calculados (somente leitura):**
- `valor_hora` (DECIMAL) - Valor da hora (calculado conforme regras financeiras)
- `valor_total` (DECIMAL) - Valor total (horas × valor_hora)

**Validações:**
- Colaborador é obrigatório
- Caso é obrigatório
- Data não pode ser futura
- Horas devem ser maior que 0 e menor ou igual a 24
- Descrição é obrigatória

**Ações Disponíveis:**
- Botão "Salvar como Rascunho" - Salva com status "rascunho"
- Botão "Enviar" - Salva e aprova automaticamente
- Botão "Cancelar" - Volta para listagem

**Regras de Negócio:**
- Valor da hora é calculado automaticamente conforme regras financeiras do caso
- Reajuste monetário é aplicado se data_reajuste <= data_apontamento
- Sócio/Administrativo pode lançar para qualquer colaborador
- Timesheet pode ser editado até faturamento entrar em revisão

---

### 2.12. Listagem de Faturamentos

**Rota:** `/faturamentos`

**Categoria de Acesso:** Sócio, Administrativo

**Descrição:** Lista todos os faturamentos do sistema.

**Campos na Tabela:**
- Número/ID
- Contrato
- Período
- Valor Bruto
- Valor Líquido
- Status
- Data de Criação
- Ações (visualizar, editar, revisar, gerar NF)

**Filtros Disponíveis:**
- Busca por contrato
- Filtro por status
- Filtro por contrato
- Filtro por período

**Ações Disponíveis:**
- Botão "Novo Faturamento" - Abre formulário de criação
- Botão "Visualizar" - Abre detalhes
- Botão "Editar" - Abre formulário de edição (se em rascunho)
- Botão "Revisar" - Abre tela de revisão (se em revisão)
- Botão "Gerar NF" - Gera nota fiscal (se revisão completa)
- Botão "Exportar" - Exporta lista

**Regras de Negócio:**
- Lista paginada
- Status determina ações disponíveis

---

### 2.13. Formulário de Faturamento (Criar/Editar)

**Rota:** `/faturamentos/novo` ou `/faturamentos/:id/editar`

**Categoria de Acesso:** Sócio, Administrativo

**Descrição:** Formulário para criar ou editar faturamento.

**Campos:**
- `contrato_id` (SELECT, obrigatório) - Contrato
- `periodo_inicio` (DATE, obrigatório) - Início do período
- `periodo_fim` (DATE, obrigatório) - Fim do período
- `financeiro_id` (SELECT, obrigatório) - Financeiro responsável

**Seleção de Itens:**
- Lista de itens em aberto (consolidados via API):
  - Timesheets não faturados
  - Pagamentos únicos não faturados
  - Pagamentos recorrentes não faturados
- Checkboxes para selecionar itens
- Agrupamento por caso

**Campos Calculados (somente leitura):**
- `valor_bruto` (DECIMAL) - Soma dos valores originais
- `valor_liquido` (DECIMAL) - Valor bruto - impostos (calculado após revisão)

**Validações:**
- Contrato é obrigatório
- Período deve ser válido (início <= fim)
- Pelo menos um item deve ser selecionado
- Todos os itens devem pertencer ao mesmo contrato

**Ações Disponíveis:**
- Botão "Salvar como Rascunho" - Salva com status "rascunho"
- Botão "Enviar para Revisão" - Envia para revisão
- Botão "Cancelar" - Volta para listagem

**Regras de Negócio:**
- API consolida itens em tempo de execução
- Pode incluir itens de múltiplos casos do mesmo contrato
- Revisores são copiados da configuração do contrato

---

### 2.14. Tela de Revisão de Faturamento

**Rota:** `/faturamentos/:id/revisar`

**Categoria de Acesso:** Sócio, Administrativo (podem revisar qualquer), Advogado (apenas onde é revisor)

**Descrição:** Tela para revisar faturamento e editar timesheets.

**Informações Exibidas:**
- Dados do faturamento (contrato, período, valores)
- Lista de casos incluídos
- Lista de itens de faturamento:
  - Timesheets (com possibilidade de edição)
  - Pagamentos únicos
  - Pagamentos recorrentes
  - Despesas reembolsáveis

**Edição de Timesheets:**
- Revisor pode editar:
  - Horas trabalhadas
  - Descrição
  - Valor da hora (se permitido)
- Sistema recalcula valor_total automaticamente
- Atualiza valor_revisado do item de faturamento

**Ações Disponíveis:**
- Botão "Aprovar" - Aprova e passa para próximo revisor
- Botão "Rejeitar" - Rejeita e volta para rascunho (com observações)
- Botão "Salvar Alterações" - Salva alterações em timesheets sem aprovar

**Validações:**
- Revisor só pode revisar quando for sua vez (ordem)
- Alterações devem ser justificadas (observações)

**Regras de Negócio:**
- Revisão ocorre sequencialmente conforme ordem
- Revisores podem alterar timesheets durante revisão
- Alterações atualizam valor_revisado do item
- Último revisor aprova → status muda para "revisao_completa"

---

### 2.15. Listagem de Cobranças

**Rota:** `/cobrancas`

**Categoria de Acesso:** Sócio, Administrativo

**Descrição:** Lista todas as cobranças do sistema.

**Campos na Tabela:**
- Número da NF
- Cliente
- Valor
- Data de Vencimento
- Status
- Data de Envio
- Ações (visualizar, enviar email, marcar como paga)

**Filtros Disponíveis:**
- Busca por cliente/NF
- Filtro por status
- Filtro por data de vencimento
- Filtro por cliente

**Ações Disponíveis:**
- Botão "Visualizar" - Abre detalhes
- Botão "Enviar E-mail" - Envia e-mail de cobrança
- Botão "Marcar como Paga" - Atualiza status
- Botão "Exportar" - Exporta lista

**Regras de Negócio:**
- Status é atualizado automaticamente quando pagamento é confirmado
- Lista paginada

---

### 2.16. Detalhes da Cobrança

**Rota:** `/cobrancas/:id`

**Categoria de Acesso:** Sócio, Administrativo

**Descrição:** Visualização detalhada de uma cobrança.

**Seções:**
1. **Dados da Cobrança** - Informações principais
2. **Nota Fiscal** - Dados da NF vinculada
3. **Boleto** - Código de barras, linha digitável, URL
4. **E-mail** - Template usado, histórico de envios
5. **Pagamentos** - Pagamentos vinculados

**Ações Disponíveis:**
- Botão "Enviar E-mail" - Envia e-mail de cobrança
- Botão "Reenviar E-mail" - Reenvia e-mail
- Botão "Visualizar Boleto" - Abre boleto em nova aba
- Botão "Marcar como Paga" - Atualiza status manualmente

**Regras de Negócio:**
- Mostra histórico de envios de e-mail
- Status atualiza automaticamente quando pagamento é confirmado

---

### 2.17. Listagem de Pagamentos

**Rota:** `/pagamentos`

**Categoria de Acesso:** Sócio, Administrativo

**Descrição:** Lista todos os pagamentos (recebidos e realizados).

**Campos na Tabela:**
- Tipo (recebido/realizado)
- Origem/Destino
- Valor
- Data
- Status
- Forma de Pagamento
- Ações (visualizar, confirmar, editar)

**Filtros Disponíveis:**
- Busca por origem/destino
- Filtro por tipo
- Filtro por status
- Filtro por data

**Ações Disponíveis:**
- Botão "Novo Pagamento" - Abre formulário de criação
- Botão "Visualizar" - Abre detalhes
- Botão "Confirmar" - Confirma pagamento
- Botão "Editar" - Abre formulário de edição

**Regras de Negócio:**
- Lista paginada
- Confirmação atualiza status de cobrança automaticamente

---

### 2.18. Formulário de Pagamento (Criar/Editar)

**Rota:** `/pagamentos/novo` ou `/pagamentos/:id/editar`

**Categoria de Acesso:** Sócio, Administrativo

**Descrição:** Formulário para criar ou editar pagamento.

**Campos:**
- `tipo` (SELECT, obrigatório) - Tipo (recebido/realizado)
- `origem_tipo` (SELECT, condicional) - Tipo de origem (cliente, caso, despesa, etc.)
- `origem_id` (SELECT, condicional) - Origem específica
- `destino_tipo` (SELECT, condicional) - Tipo de destino (prestador, colaborador, etc.)
- `destino_id` (SELECT, condicional) - Destino específico
- `valor` (DECIMAL, obrigatório) - Valor
- `data_pagamento` (DATE, obrigatório) - Data de pagamento
- `forma_pagamento` (SELECT, obrigatório) - Forma de pagamento
- `cobranca_id` (SELECT, opcional) - Cobrança vinculada (se recebido)
- `observacoes` (TEXTAREA, opcional) - Observações

**Validações:**
- Tipo é obrigatório
- Valor deve ser maior que 0
- Data não pode ser futura
- Se vinculado à cobrança, valor não pode exceder valor da cobrança

**Ações Disponíveis:**
- Botão "Salvar" - Salva pagamento
- Botão "Salvar e Confirmar" - Salva e confirma pagamento
- Botão "Cancelar" - Volta para listagem

**Regras de Negócio:**
- Pagamento pode ser parcial (parcelas)
- Múltiplos pagamentos podem quitar uma cobrança
- Confirmação atualiza status de cobrança automaticamente

---

### 2.19. Listagem de Despesas

**Rota:** `/despesas`

**Categoria de Acesso:** Sócio, Administrativo

**Descrição:** Lista todas as despesas do sistema.

**Campos na Tabela:**
- Descrição
- Caso (se reembolsável)
- Valor
- Data
- Status
- Tipo (reembolsável/não reembolsável)
- Ações (visualizar, editar, pagar)

**Filtros Disponíveis:**
- Busca por descrição
- Filtro por tipo
- Filtro por status
- Filtro por caso
- Filtro por data

**Ações Disponíveis:**
- Botão "Nova Despesa" - Abre formulário de criação
- Botão "Visualizar" - Abre detalhes
- Botão "Editar" - Abre formulário de edição
- Botão "Pagar" - Cria pagamento vinculado

**Regras de Negócio:**
- Lista paginada
- Despesas reembolsáveis podem ser incluídas em faturamentos

---

### 2.20. Formulário de Despesa (Criar/Editar)

**Rota:** `/despesas/novo` ou `/despesas/:id/editar`

**Categoria de Acesso:** Sócio, Administrativo

**Descrição:** Formulário para criar ou editar despesa.

**Campos:**
- `tipo` (SELECT, obrigatório) - Tipo (reembolsável/não reembolsável)
- `caso_id` (SELECT, condicional) - Caso (obrigatório se reembolsável)
- `descricao` (STRING, obrigatório) - Descrição
- `valor` (DECIMAL, obrigatório) - Valor
- `data_despesa` (DATE, obrigatório) - Data da despesa
- `prestador_servico_id` (SELECT, opcional) - Prestador de serviço
- `data_vencimento` (DATE, opcional) - Data de vencimento

**Validações:**
- Tipo é obrigatório
- Caso é obrigatório se for reembolsável
- Valor deve ser maior que 0
- Data não pode ser futura

**Ações Disponíveis:**
- Botão "Salvar" - Salva despesa
- Botão "Cancelar" - Volta para listagem

**Regras de Negócio:**
- Despesas reembolsáveis devem estar vinculadas a um caso
- Despesas reembolsáveis podem ser incluídas em faturamentos

---

### 2.21. Listagem de Colaboradores

**Rota:** `/colaboradores`

**Categoria de Acesso:** Sócio, Administrativo

**Descrição:** Lista todos os colaboradores do sistema.

**Campos na Tabela:**
- Nome
- Email
- Categoria
- Cargo
- Área
- Status (ativo/inativo)
- Ações (visualizar, editar, gerenciar permissões)

**Filtros Disponíveis:**
- Busca por nome/email
- Filtro por categoria
- Filtro por cargo
- Filtro por área
- Filtro por status

**Ações Disponíveis:**
- Botão "Novo Colaborador" - Abre formulário de criação
- Botão "Visualizar" - Abre detalhes
- Botão "Editar" - Abre formulário de edição
- Botão "Gerenciar Permissões" - Abre tela de permissões
- Botão "Exportar" - Exporta lista

**Regras de Negócio:**
- Lista paginada

---

### 2.22. Formulário de Colaborador (Criar/Editar)

**Rota:** `/colaboradores/novo` ou `/colaboradores/:id/editar`

**Categoria de Acesso:** Sócio, Administrativo

**Descrição:** Formulário para criar ou editar colaborador.

**Campos:**

**Dados Básicos:**
- `nome` (STRING, obrigatório) - Nome completo
- `email` (EMAIL, obrigatório) - Email (usado para login)
- `cpf` (STRING, obrigatório) - CPF
- `data_nascimento` (DATE, opcional) - Data de nascimento
- `categoria` (SELECT, obrigatório) - Categoria (sócio, advogado, administrativo, estagiário)
- `cargo_id` (SELECT, obrigatório) - Cargo
- `area_id` (SELECT, opcional) - Área/Centro de custo
- `oab` (STRING, condicional) - OAB (obrigatório se categoria = advogado)

**Endereço:**
- `rua` (STRING, opcional)
- `numero` (STRING, opcional)
- `complemento` (STRING, opcional)
- `cidade` (STRING, opcional)
- `estado` (SELECT, opcional) - UF

**Dados Profissionais:**
- `adicional` (SELECT, opcional) - Adicional (Liderança, Estratégico)
- `percentual_adicional` (DECIMAL, condicional) - Percentual (5-20%, se adicional informado)
- `salario` (DECIMAL, opcional) - Salário
- `beneficios` (MULTISELECT, opcional) - Benefícios (Plano de Saúde, Auxílio Previdenciária)

**Dados Bancários:**
- `banco` (STRING, opcional)
- `conta` (STRING, opcional)
- `digito` (STRING, opcional)
- `agencia` (STRING, opcional)
- `chave_pix` (STRING, opcional)

**Contato:**
- `whatsapp` (STRING, opcional) - WhatsApp

**Validações:**
- Nome é obrigatório
- Email é obrigatório e único
- CPF é obrigatório e único
- OAB é obrigatório se categoria = advogado
- Percentual adicional deve estar entre 5 e 20 (se adicional informado)

**Ações Disponíveis:**
- Botão "Salvar" - Salva colaborador
- Botão "Cancelar" - Volta para listagem

**Regras de Negócio:**
- Email é usado para login
- CPF deve ser único
- OAB deve ser único (se informado)

---

### 2.23. Gerenciamento de Permissões

**Rota:** `/colaboradores/:id/permissoes`

**Categoria de Acesso:** Sócio, Administrativo

**Descrição:** Tela para gerenciar permissões de um colaborador.

**Campos:**
- `herdar_cargo` (BOOLEAN) - Checkbox "Herdar permissões do cargo"
- `permissoes_customizadas` (JSONB) - Permissões customizadas (editor JSON ou interface visual)

**Visualização:**
- Lista de features do cargo (se herdar_cargo = true)
- Lista de permissões customizadas
- Lista de permissões efetivas (resultado final)

**Ações Disponíveis:**
- Botão "Salvar" - Salva permissões
- Botão "Cancelar" - Volta para detalhes do colaborador
- Botão "Adicionar Permissão" - Adiciona permissão customizada
- Botão "Remover Permissão" - Remove permissão customizada

**Regras de Negócio:**
- Se herdar_cargo = true: permissões = cargo + customizações (customizações têm prioridade)
- Se herdar_cargo = false: permissões = apenas customizações
- Permissões são verificadas em tempo de execução

---

### 2.24. Listagem de Avaliações PDI

**Rota:** `/avaliacoes-pdi`

**Categoria de Acesso:** Sócio, Administrativo

**Descrição:** Lista todas as avaliações PDI.

**Campos na Tabela:**
- Colaborador
- Ano
- Tipo (prévia/definitiva)
- Nota Final
- Resultado
- Status
- Ações (visualizar, editar)

**Filtros Disponíveis:**
- Busca por colaborador
- Filtro por ano
- Filtro por tipo
- Filtro por resultado

**Ações Disponíveis:**
- Botão "Nova Avaliação" - Abre formulário de criação
- Botão "Visualizar" - Abre detalhes
- Botão "Editar" - Abre formulário de edição
- Botão "Exportar" - Exporta lista

**Regras de Negócio:**
- Lista paginada

---

### 2.25. Formulário de Avaliação PDI (Criar/Editar)

**Rota:** `/avaliacoes-pdi/novo` ou `/avaliacoes-pdi/:id/editar`

**Categoria de Acesso:** Sócio, Administrativo

**Descrição:** Formulário para criar ou editar avaliação PDI.

**Campos:**
- `colaborador_id` (SELECT, obrigatório) - Colaborador
- `ano` (NUMBER, obrigatório) - Ano de avaliação
- `tipo` (SELECT, obrigatório) - Tipo (prévia/definitiva)

**DNA VLMA:**
- `dna_nome` (STRING, obrigatório) - Nome
- `dna_descricao` (TEXTAREA, obrigatório) - Descrição
- `dna_nota` (NUMBER, obrigatório) - Nota (0-10)

**Skills da Carreira:**
- Lista de skills (5 campos se normal, 8 campos se liderança/estratégico):
  - `skill_nome` (STRING, obrigatório) - Nome
  - `skill_descricao` (TEXTAREA, obrigatório) - Descrição
  - `skill_nota` (NUMBER, obrigatório) - Nota (0-10)
- Botão "Adicionar Skill" - Adiciona novo skill

**Metas Individuais:**
- Lista de metas (até 5 campos):
  - `meta_nome` (STRING, obrigatório) - Nome
  - `meta_descricao` (TEXTAREA, obrigatório) - Descrição
  - `meta_nota` (NUMBER, obrigatório) - Nota (0-10)
- Botão "Adicionar Meta" - Adiciona nova meta

**Resultado (calculado automaticamente):**
- `nota_final` (DECIMAL, somente leitura) - Nota final (média simples)
- `resultado` (SELECT, somente leitura) - Resultado (mantém faixa atual, progressão simples, progressão diferenciada)

**Bônus:**
- `bonus_pdi` (BOOLEAN) - Checkbox "Bônus PDI"
- `bonus_performance_plus` (DECIMAL, opcional) - Bônus Performance Plus (R$)
- `bonus_comercial` (DECIMAL, opcional) - Bônus Comercial (R$)

**Observações:**
- `observacoes` (TEXTAREA, opcional) - Observações

**Validações:**
- Colaborador é obrigatório
- Ano é obrigatório
- Tipo é obrigatório
- DNA VLMA é obrigatório (1 campo)
- Skills: 5 campos (normal) ou 8 campos (liderança/estratégico)
- Metas: máximo 5 campos
- Todas as notas devem estar entre 0 e 10

**Ações Disponíveis:**
- Botão "Salvar" - Salva avaliação
- Botão "Cancelar" - Volta para listagem

**Regras de Negócio:**
- Nota final é calculada automaticamente (média simples)
- Resultado é determinado automaticamente pela nota final
- Skills: quantidade depende do adicional do colaborador

---

### 2.26. Configurações do Sistema

**Rota:** `/configuracoes`

**Categoria de Acesso:** Sócio, Administrativo

**Descrição:** Tela para gerenciar configurações gerais do sistema.

**Seções:**
1. **Geral** - Configurações gerais
2. **E-mail** - Configurações de e-mail
3. **Integrações** - Integrações externas
4. **Backup** - Configurações de backup

**Campos (exemplos):**
- Nome da empresa
- Logo
- Configurações de e-mail (SMTP)
- Chaves de API
- etc.

**Ações Disponíveis:**
- Botão "Salvar" - Salva configurações
- Botão "Cancelar" - Desfaz alterações

**Regras de Negócio:**
- Configurações são globais
- Alterações requerem confirmação

---

### 2.27. Listagem de Parceiros

**Rota:** `/parceiros`

**Categoria de Acesso:** Sócio, Administrativo

**Descrição:** Lista todos os parceiros (escritórios de advocacia) cadastrados.

**Campos na Tabela:**
- Nome do Escritório
- CNPJ
- Advogado Responsável
- Cidade/Estado
- Ações (visualizar, editar, deletar)

**Filtros Disponíveis:**
- Busca por nome/CNPJ
- Filtro por cidade/estado

**Ações Disponíveis:**
- Botão "Novo Parceiro" - Abre formulário de criação
- Botão "Visualizar" - Abre detalhes
- Botão "Editar" - Abre formulário de edição
- Botão "Deletar" - Remove parceiro

**Regras de Negócio:**
- Lista paginada

---

### 2.28. Formulário de Parceiro (Criar/Editar)

**Rota:** `/parceiros/novo` ou `/parceiros/:id/editar`

**Categoria de Acesso:** Sócio, Administrativo

**Descrição:** Formulário para criar ou editar parceiro.

**Campos:**

**Dados Básicos:**
- `nome_escritorio` (STRING, obrigatório) - Nome do escritório
- `cnpj` (STRING, obrigatório) - CNPJ

**Endereço:**
- `rua` (STRING, opcional)
- `numero` (STRING, opcional)
- `complemento` (STRING, opcional)
- `cidade` (STRING, opcional)
- `estado` (SELECT, opcional) - UF

**Advogado Responsável:**
- `nome` (STRING, obrigatório)
- `email` (EMAIL, opcional)
- `oab` (STRING, obrigatório) - OAB
- `cpf` (STRING, obrigatório) - CPF
- `whatsapp` (STRING, opcional)

**Responsável Financeiro:**
- `nome` (STRING, obrigatório)
- `email` (EMAIL, opcional)
- `whatsapp` (STRING, opcional)

**Dados Bancários:**
- `banco` (STRING, obrigatório)
- `conta_com_digito` (STRING, obrigatório)
- `agencia` (STRING, obrigatório)
- `chave_pix` (STRING, opcional)

**Validações:**
- CNPJ deve ser válido e único
- OAB é obrigatório para advogado responsável
- CPF é obrigatório para advogado responsável

**Ações Disponíveis:**
- Botão "Salvar" - Salva parceiro
- Botão "Cancelar" - Volta para listagem

---

### 2.29. Listagem de Prestadores de Serviço

**Rota:** `/prestadores-servico`

**Categoria de Acesso:** Sócio, Administrativo

**Descrição:** Lista todos os prestadores de serviço cadastrados.

**Campos na Tabela:**
- Nome do Prestador
- Categoria do Serviço
- Serviço Recorrente
- Valor (se recorrente)
- CPF/CNPJ
- Ações (visualizar, editar, deletar)

**Filtros Disponíveis:**
- Busca por nome/CPF/CNPJ
- Filtro por categoria
- Filtro por serviço recorrente

**Ações Disponíveis:**
- Botão "Novo Prestador" - Abre formulário de criação
- Botão "Visualizar" - Abre detalhes
- Botão "Editar" - Abre formulário de edição
- Botão "Deletar" - Remove prestador

---

### 2.30. Formulário de Prestador de Serviço (Criar/Editar)

**Rota:** `/prestadores-servico/novo` ou `/prestadores-servico/:id/editar`

**Categoria de Acesso:** Sócio, Administrativo

**Descrição:** Formulário para criar ou editar prestador de serviço.

**Campos:**
- `nome` (STRING, obrigatório) - Nome do prestador
- `servico_recorrente` (BOOLEAN) - Checkbox "Serviço Recorrente"
- `valor_recorrente` (DECIMAL, condicional) - Valor (se recorrente)
- `categoria_servico_id` (SELECT, obrigatório) - Categoria do serviço
- `cpf_cnpj` (STRING, obrigatório) - CPF ou CNPJ
- Endereço completo
- Responsável interno (opcional)
- Dados bancários

**Validações:**
- Nome é obrigatório
- Categoria é obrigatória
- Valor é obrigatório se serviço recorrente

**Ações Disponíveis:**
- Botão "Salvar" - Salva prestador
- Botão "Cancelar" - Volta para listagem

---

### 2.31. Cadastros Auxiliares

**Rota:** `/cadastros`

**Categoria de Acesso:** Sócio, Administrativo

**Descrição:** Tela para gerenciar cadastros auxiliares do sistema.

**Seções:**
1. **Produtos** - Lista de produtos
2. **Segmentos Econômicos** - Lista de segmentos
3. **Grupos Econômicos** - Lista de grupos
4. **Categorias de Serviços** - Lista de categorias
5. **Centros de Custo** - Lista de centros de custo
6. **Áreas** - Lista de áreas

**Para cada seção:**
- Lista de itens
- Botão "Novo" - Adiciona novo item
- Botão "Editar" - Edita item
- Botão "Deletar" - Remove item

**Campos (genéricos):**
- `nome` (STRING, obrigatório) - Nome (único)

**Validações:**
- Nome é obrigatório e único

**Regras de Negócio:**
- Itens são usados em outras partes do sistema
- Não pode deletar item em uso

---

### 2.32. Listagem de Indicações de Negócios

**Rota:** `/indicacoes-negocios`

**Categoria de Acesso:** Sócio, Administrativo

**Descrição:** Lista todas as indicações de negócios.

**Campos na Tabela:**
- Contrato
- Indicador
- Valor/Percentual
- Periodicidade
- Status
- Ações (visualizar, editar)

**Filtros Disponíveis:**
- Busca por contrato/indicador
- Filtro por status
- Filtro por periodicidade

**Ações Disponíveis:**
- Botão "Nova Indicação" - Abre formulário de criação
- Botão "Visualizar" - Abre detalhes
- Botão "Editar" - Abre formulário de edição

**Regras de Negócio:**
- Indicações são configuradas no contrato
- Histórico de pagamentos é mantido

---

### 2.33. Listagem de Templates de E-mail

**Rota:** `/templates-email`

**Categoria de Acesso:** Sócio, Administrativo

**Descrição:** Lista todos os templates de e-mail para cobranças.

**Campos na Tabela:**
- Nome
- Assunto
- Tipo
- Última Atualização
- Ações (visualizar, editar, deletar)

**Filtros Disponíveis:**
- Busca por nome
- Filtro por tipo

**Ações Disponíveis:**
- Botão "Novo Template" - Abre formulário de criação
- Botão "Visualizar" - Abre preview
- Botão "Editar" - Abre editor
- Botão "Deletar" - Remove template

---

### 2.34. Editor de Template de E-mail

**Rota:** `/templates-email/novo` ou `/templates-email/:id/editar`

**Categoria de Acesso:** Sócio, Administrativo

**Descrição:** Editor para criar ou editar template de e-mail.

**Campos:**
- `nome` (STRING, obrigatório) - Nome do template
- `assunto` (STRING, obrigatório) - Assunto do e-mail
- `tipo` (SELECT, obrigatório) - Tipo (cobrança, lembrete, etc.)
- `corpo` (RICH_TEXT, obrigatório) - Corpo do e-mail (HTML)

**Variáveis Disponíveis:**
- {nome_cliente}
- {valor}
- {data_vencimento}
- {linha_digitavel}
- {url_boleto}
- etc.

**Ações Disponíveis:**
- Botão "Salvar" - Salva template
- Botão "Preview" - Visualiza template
- Botão "Cancelar" - Volta para listagem

**Regras de Negócio:**
- Template suporta variáveis dinâmicas
- Preview mostra exemplo com dados fictícios

---

### 2.35. Listagem de Cargos

**Rota:** `/cargos`

**Categoria de Acesso:** Sócio, Administrativo

**Descrição:** Lista todos os cargos do sistema.

**Campos na Tabela:**
- Nome
- Faixa Salarial
- Quantidade de Features
- Ações (visualizar, editar, deletar)

**Filtros Disponíveis:**
- Busca por nome

**Ações Disponíveis:**
- Botão "Novo Cargo" - Abre formulário de criação
- Botão "Visualizar" - Abre detalhes
- Botão "Editar" - Abre formulário de edição
- Botão "Deletar" - Remove cargo

---

### 2.36. Formulário de Cargo (Criar/Editar)

**Rota:** `/cargos/novo` ou `/cargos/:id/editar`

**Categoria de Acesso:** Sócio, Administrativo

**Descrição:** Formulário para criar ou editar cargo.

**Campos:**
- `nome` (STRING, obrigatório) - Nome do cargo
- `faixa_salarial_min` (DECIMAL, opcional) - Faixa salarial mínima
- `faixa_salarial_max` (DECIMAL, opcional) - Faixa salarial máxima

**Features do Cargo:**
- Lista de features disponíveis no sistema
- Checkboxes para selecionar features permitidas

**Ações Disponíveis:**
- Botão "Salvar" - Salva cargo
- Botão "Cancelar" - Volta para listagem

**Regras de Negócio:**
- Features definem permissões base do cargo
- Colaboradores herdam features do cargo

---

### 2.37. Gerenciador de Documentos (GED)

**Rota:** `/documentos`

**Categoria de Acesso:** Sócio, Administrativo

**Descrição:** Gerenciador de documentos do sistema.

**Funcionalidades:**
- Upload de documentos
- Organização por pastas/categorias
- Busca de documentos
- Visualização de documentos
- Download de documentos
- Compartilhamento de documentos

**Ações Disponíveis:**
- Botão "Upload" - Faz upload de documento
- Botão "Nova Pasta" - Cria nova pasta
- Botão "Visualizar" - Abre documento
- Botão "Download" - Baixa documento
- Botão "Deletar" - Remove documento

**Regras de Negócio:**
- Documentos podem ser vinculados a contratos, casos, etc.
- Suporta múltiplos formatos
- Controle de versão

---

### 2.38. Logs de Auditoria

**Rota:** `/logs-auditoria`

**Categoria de Acesso:** Sócio, Administrativo

**Descrição:** Visualização de logs de auditoria do sistema.

**Campos na Tabela:**
- Data/Hora
- Usuário
- Ação
- Entidade
- ID do Registro
- Dados Anteriores
- Dados Novos
- IP

**Filtros Disponíveis:**
- Busca por usuário/ação
- Filtro por data
- Filtro por entidade
- Filtro por ação

**Ações Disponíveis:**
- Botão "Visualizar Detalhes" - Abre detalhes do log
- Botão "Exportar" - Exporta logs

**Regras de Negócio:**
- Logs são somente leitura
- Não podem ser editados ou deletados
- Retenção configurável

---

### 2.39. Relatórios

**Rota:** `/relatorios`

**Categoria de Acesso:** Sócio, Administrativo

**Descrição:** Tela para gerar e visualizar relatórios.

**Tipos de Relatórios:**
- Faturamento mensal
- Timesheets por colaborador
- Cobranças pendentes
- Despesas por período
- Avaliações PDI
- Performance de colaboradores
- etc.

**Campos:**
- Tipo de relatório (SELECT)
- Período (DATE range)
- Filtros específicos conforme tipo

**Ações Disponíveis:**
- Botão "Gerar Relatório" - Gera relatório
- Botão "Exportar" - Exporta relatório (PDF/Excel)

**Regras de Negócio:**
- Relatórios podem ser exportados
- Filtros variam conforme tipo de relatório

---

## 3. Telas para Advogado

### 3.1. Listagem de Contratos (Somente Leitura)

**Rota:** `/contratos`

**Categoria de Acesso:** Advogado

**Descrição:** Lista todos os contratos (somente visualização).

**Campos na Tabela:**
- Nome do Contrato
- Cliente
- Status
- Data de Início
- Data de Término
- Ações (visualizar)

**Filtros Disponíveis:**
- Busca por nome/cliente
- Filtro por status
- Filtro por cliente

**Ações Disponíveis:**
- Botão "Visualizar" - Abre detalhes (somente leitura)
- **NÃO tem botão "Novo Contrato"**
- **NÃO tem botão "Editar"**

**Regras de Negócio:**
- Apenas visualização
- Não pode criar/editar contratos

---

### 3.2. Detalhes do Contrato (Somente Leitura com Anexos)

**Rota:** `/contratos/:id`

**Categoria de Acesso:** Advogado

**Descrição:** Visualização detalhada de um contrato.

**Abas:**
1. **Geral** - Dados básicos (somente leitura)
2. **Casos** - Lista de casos (somente leitura)
3. **Documentos** - Anexos e documentos (pode adicionar)

**Ações Disponíveis:**
- Botão "Adicionar Anexo" - Permite adicionar documento
- **NÃO tem botão "Editar"**
- **NÃO tem botão "Novo Caso"**
- **NÃO tem botão "Configurar"**

**Regras de Negócio:**
- Pode visualizar todos os dados
- Pode adicionar anexos/documentos
- Não pode editar dados do contrato

---

### 3.3. Listagem de Timesheets (Próprios)

**Rota:** `/timesheets`

**Categoria de Acesso:** Advogado

**Descrição:** Lista apenas os próprios timesheets.

**Campos na Tabela:**
- Caso
- Data
- Horas
- Valor Total
- Status
- Faturado
- Ações (visualizar, editar)

**Filtros Disponíveis:**
- Busca por caso
- Filtro por status
- Filtro por data
- Filtro por faturado/não faturado

**Ações Disponíveis:**
- Botão "Novo Timesheet" - Abre formulário de criação (apenas para si mesmo)
- Botão "Visualizar" - Abre detalhes
- Botão "Editar" - Abre formulário de edição (apenas próprios, se não estiver em faturamento em revisão)
- **NÃO tem botão "Deletar"** (ou apenas para próprios em rascunho)

**Regras de Negócio:**
- Vê apenas seus próprios timesheets
- Pode lançar apenas para si mesmo
- Pode editar apenas próprios timesheets (até faturamento entrar em revisão)

---

### 3.4. Formulário de Timesheet (Criar/Editar - Próprio)

**Rota:** `/timesheets/novo` ou `/timesheets/:id/editar`

**Categoria de Acesso:** Advogado

**Descrição:** Formulário para criar ou editar timesheet próprio.

**Campos:**
- `colaborador_id` (SELECT, desabilitado) - Colaborador (sempre o próprio, não editável)
- `caso_id` (SELECT, obrigatório) - Caso
- `data` (DATE, obrigatório) - Data do apontamento
- `horas` (DECIMAL, obrigatório) - Quantidade de horas
- `descricao` (TEXTAREA, obrigatório) - Descrição do trabalho

**Validações:**
- Caso é obrigatório
- Data não pode ser futura
- Horas devem ser maior que 0 e menor ou igual a 24
- Descrição é obrigatória

**Ações Disponíveis:**
- Botão "Salvar como Rascunho" - Salva com status "rascunho"
- Botão "Enviar" - Salva e aprova automaticamente
- Botão "Cancelar" - Volta para listagem

**Regras de Negócio:**
- Pode criar apenas para si mesmo
- Pode editar apenas próprios timesheets
- Não pode editar se faturamento estiver em revisão

---

### 3.5. Listagem de Faturamentos (Onde é Revisor)

**Rota:** `/faturamentos`

**Categoria de Acesso:** Advogado

**Descrição:** Lista apenas faturamentos onde está configurado como revisor.

**Campos na Tabela:**
- Número/ID
- Contrato
- Período
- Valor Bruto
- Valor Líquido
- Status
- Minha Ordem de Revisão
- Ações (visualizar, revisar)

**Filtros Disponíveis:**
- Busca por contrato
- Filtro por status
- Filtro por contrato

**Ações Disponíveis:**
- Botão "Visualizar" - Abre detalhes
- Botão "Revisar" - Abre tela de revisão (se for sua vez)
- **NÃO tem botão "Novo Faturamento"**
- **NÃO tem botão "Editar"**
- **NÃO tem botão "Gerar NF"**

**Regras de Negócio:**
- Vê apenas faturamentos onde está configurado como revisor
- Pode revisar apenas quando for sua vez (ordem)
- Não pode criar/editar faturamentos

---

### 3.6. Tela de Revisão de Faturamento (Advogado)

**Rota:** `/faturamentos/:id/revisar`

**Categoria de Acesso:** Advogado (apenas onde é revisor)

**Descrição:** Tela para revisar faturamento (mesma funcionalidade que Sócio/Admin, mas apenas para faturamentos onde é revisor).

**Informações Exibidas:**
- Dados do faturamento
- Lista de casos incluídos
- Lista de itens de faturamento (pode editar timesheets)

**Edição de Timesheets:**
- Pode editar timesheets durante revisão
- Sistema recalcula valores automaticamente

**Ações Disponíveis:**
- Botão "Aprovar" - Aprova e passa para próximo revisor
- Botão "Rejeitar" - Rejeita e volta para rascunho
- Botão "Salvar Alterações" - Salva alterações sem aprovar

**Validações:**
- Só pode revisar quando for sua vez (ordem)
- Deve estar configurado como revisor no contrato

**Regras de Negócio:**
- Pode revisar apenas faturamentos onde está configurado como revisor
- Pode editar timesheets durante revisão
- Revisão ocorre sequencialmente

---

### 3.7. Itens a Faturar (Onde é Revisor)

**Rota:** `/faturamentos/itens-abertos`

**Categoria de Acesso:** Advogado

**Descrição:** Visualiza itens em aberto apenas dos faturamentos onde é revisor + seus próprios timesheets.

**Informações Exibidas:**
- Lista de itens agrupados por contrato/caso:
  - Seus próprios timesheets não faturados
  - Itens de faturamentos onde é revisor

**Filtros Disponíveis:**
- Filtro por contrato
- Filtro por caso

**Ações Disponíveis:**
- Botão "Visualizar" - Abre detalhes do item
- **NÃO tem botão "Criar Faturamento"**

**Regras de Negócio:**
- Vê apenas itens de faturamentos onde é revisor
- Vê seus próprios timesheets
- Não pode criar faturamentos

---

## 4. Telas para Estagiário

### 4.1. Listagem de Contratos (Para Lançar Timesheet)

**Rota:** `/contratos`

**Categoria de Acesso:** Estagiário

**Descrição:** Lista contratos apenas para selecionar ao lançar timesheet.

**Campos na Tabela:**
- Nome do Contrato
- Cliente
- Status
- Ações (visualizar casos)

**Filtros Disponíveis:**
- Busca por nome/cliente
- Filtro por status

**Ações Disponíveis:**
- Botão "Ver Casos" - Abre casos do contrato (para lançar timesheet)
- **NÃO tem botão "Novo Contrato"**
- **NÃO tem botão "Editar"**

**Regras de Negócio:**
- Apenas visualização
- Usado para selecionar contrato/caso ao lançar timesheet

---

### 4.2. Listagem de Casos (Para Lançar Timesheet)

**Rota:** `/contratos/:contrato_id/casos`

**Categoria de Acesso:** Estagiário

**Descrição:** Lista casos de um contrato para selecionar ao lançar timesheet.

**Campos na Tabela:**
- Nome do Caso
- Responsável
- Centros de Custo
- Ações (lançar timesheet)

**Ações Disponíveis:**
- Botão "Lançar Timesheet" - Abre formulário de timesheet para este caso
- **NÃO tem botão "Editar"**
- **NÃO tem botão "Visualizar Detalhes"**

**Regras de Negócio:**
- Apenas para selecionar caso ao lançar timesheet
- Não pode ver detalhes financeiros

---

### 4.3. Listagem de Timesheets (Próprios)

**Rota:** `/timesheets`

**Categoria de Acesso:** Estagiário

**Descrição:** Lista apenas os próprios timesheets.

**Campos na Tabela:**
- Caso
- Data
- Horas
- Valor Total (pode estar oculto ou limitado)
- Status
- Ações (visualizar, editar)

**Filtros Disponíveis:**
- Busca por caso
- Filtro por status
- Filtro por data

**Ações Disponíveis:**
- Botão "Novo Timesheet" - Abre formulário de criação (apenas para si mesmo)
- Botão "Visualizar" - Abre detalhes
- Botão "Editar" - Abre formulário de edição (apenas próprios em rascunho)
- **NÃO tem botão "Deletar"**

**Regras de Negócio:**
- Vê apenas seus próprios timesheets
- Pode lançar apenas para si mesmo
- Pode editar apenas próprios timesheets em rascunho
- Valor pode estar oculto ou limitado (dados financeiros sensíveis)

---

### 4.4. Formulário de Timesheet (Criar/Editar - Próprio)

**Rota:** `/timesheets/novo` ou `/timesheets/:id/editar`

**Categoria de Acesso:** Estagiário

**Descrição:** Formulário para criar ou editar timesheet próprio.

**Campos:**
- `colaborador_id` (SELECT, desabilitado) - Colaborador (sempre o próprio, não editável)
- `caso_id` (SELECT, obrigatório) - Caso (seleciona de lista de contratos)
- `data` (DATE, obrigatório) - Data do apontamento
- `horas` (DECIMAL, obrigatório) - Quantidade de horas
- `descricao` (TEXTAREA, obrigatório) - Descrição do trabalho

**Campos Calculados (pode estar oculto):**
- `valor_hora` (DECIMAL, oculto ou somente leitura) - Valor da hora
- `valor_total` (DECIMAL, oculto ou somente leitura) - Valor total

**Validações:**
- Caso é obrigatório
- Data não pode ser futura
- Horas devem ser maior que 0 e menor ou igual a 24
- Descrição é obrigatória

**Ações Disponíveis:**
- Botão "Salvar como Rascunho" - Salva com status "rascunho"
- Botão "Enviar" - Salva e aprova automaticamente
- Botão "Cancelar" - Volta para listagem

**Regras de Negócio:**
- Pode criar apenas para si mesmo
- Pode editar apenas próprios timesheets em rascunho
- Valores financeiros podem estar ocultos
- Não tem acesso a faturamentos

---

## 5. Resumo de Acessos por Categoria

### 5.1. Sócio e Administrativo

**Acesso Completo:**
- ✅ Todas as telas do sistema
- ✅ Criar, editar, deletar qualquer registro
- ✅ Gerenciar permissões
- ✅ Revisar qualquer faturamento
- ✅ Lançar timesheets para qualquer colaborador
- ✅ Gerar relatórios
- ✅ Configurações do sistema

### 5.2. Advogado

**Acesso Limitado:**
- ✅ Visualizar todos os contratos e casos (somente leitura)
- ✅ Adicionar anexos aos contratos
- ✅ Lançar timesheets apenas para si mesmo
- ✅ Ver próprios timesheets
- ✅ Revisar faturamentos onde está configurado como revisor
- ✅ Ver itens a faturar apenas dos faturamentos onde é revisor
- ❌ Não pode criar/editar contratos
- ❌ Não pode criar/editar casos
- ❌ Não pode gerar notas fiscais
- ❌ Não pode revisar sem estar configurado como revisor

### 5.3. Estagiário

**Acesso Restrito:**
- ✅ Ver contratos (para lançar timesheet)
- ✅ Ver casos (para lançar timesheet)
- ✅ Lançar timesheets apenas para si mesmo
- ✅ Ver próprios timesheets
- ✅ Editar próprios timesheets em rascunho
- ❌ Não pode ver faturamentos
- ❌ Não pode ver itens a faturar
- ❌ Não pode revisar faturamentos
- ❌ Não pode criar/editar contratos/casos
- ❌ Não pode ver dados financeiros detalhados
- ❌ Não pode gerar relatórios

---

## Observações Finais

### Navegação e Menu

O menu lateral deve ser dinâmico conforme a categoria do colaborador:
- **Sócio/Administrativo**: Menu completo com todos os módulos
- **Advogado**: Menu limitado (Contratos, Timesheets, Faturamentos onde é revisor)
- **Estagiário**: Menu mínimo (Contratos, Timesheets)

### Permissões em Tempo de Execução

Todas as telas devem verificar permissões em tempo de execução:
- Verificação de categoria do colaborador
- Verificação de vinculação (para advogado)
- Verificação de permissões customizadas
- Bloqueio de ações não permitidas

### Responsividade

Todas as telas devem ser responsivas e funcionar em:
- Desktop
- Tablet
- Mobile

### Acessibilidade

Todas as telas devem seguir padrões de acessibilidade:
- Navegação por teclado
- Contraste adequado
- Labels descritivos
- Suporte a leitores de tela
