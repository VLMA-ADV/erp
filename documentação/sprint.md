# Sprint - Cadastro de Colaboradores

**Status**: 🟡 Em Andamento  
**Data de Início**: 2024  
**Data de Término**: -  

---

## Objetivo da Sprint

Implementar o sistema de cadastro e gerenciamento de colaboradores, incluindo autenticação, recuperação de senha e interface de listagem/cadastro/edição.

---

## Atividades

### 1. Configuração do banco de dados

**Status**: ⏳ Pendente

**Descrição**: Criar schema `core` e `people` e suas respectivas tabelas.

**Tarefas**:
- [ ] Criar schema `core` no Supabase
- [ ] Criar tabelas do schema `core`:
  - [ ] `core.tenants`
  - [ ] `core.tenant_users`
  - [ ] `core.roles`
  - [ ] `core.permissions`
  - [ ] `core.role_permissions`
  - [ ] `core.user_roles`
  - [ ] `core.audit_logs`
  - [ ] `core.system_settings`
- [ ] Criar schema `people` no Supabase
- [ ] Criar tabelas do schema `people`:
  - [ ] `people.colaboradores`
  - [ ] `people.colaboradores_beneficios`
  - [ ] `people.cargos`
  - [ ] `people.cargos_features`
  - [ ] `people.areas`
  - [ ] `people.centros_custo`
- [ ] Configurar RLS (Row Level Security) para todas as tabelas
- [ ] Criar índices necessários
- [ ] Criar constraints e validações

**Referências**:
- [Schema `core`](entidades/core.md)
- [Schema `people`](entidades/people.md)

---

### 2. Criar tela de login

**Status**: ⏳ Pendente

**Descrição**: Tela deve ter campo de e-mail, senha, botão de esqueci minha senha e botão de login.

**Regras**:
- Os usuários cadastrados devem conseguir logar
- Após login bem-sucedido, redirecionar para a tela home

**Tarefas**:
- [ ] Criar componente de login
- [ ] Implementar campos: e-mail e senha
- [ ] Implementar botão "Esqueci minha senha" (link para tela de recuperação)
- [ ] Implementar botão de login
- [ ] Integrar com Supabase Auth
- [ ] Implementar tratamento de erros
- [ ] Implementar redirecionamento para home após login
- [ ] Adicionar validação de campos

---

### 3. Criar tela de recuperar senha

**Status**: ⏳ Pendente

**Descrição**: Tela deve ter campo para solicitar link pelo e-mail.

**Regras**:
- Somente membros cadastrados receberão o e-mail
- A mensagem de "e-mail enviado" deve ser exibida para todos (mesmo que o e-mail não exista no sistema, por segurança)

**Tarefas**:
- [ ] Criar componente de recuperação de senha
- [ ] Implementar campo de e-mail
- [ ] Implementar botão de envio
- [ ] Integrar com Supabase Auth (reset password)
- [ ] Implementar mensagem de sucesso (sempre exibir, independente do e-mail existir)
- [ ] Adicionar validação de e-mail
- [ ] Implementar tratamento de erros

---

### 4. Criar tela de redefinir a senha

**Status**: ⏳ Pendente

**Descrição**: Essa será a tela que o link do e-mail irá direcionar. Deve ter dois campos para colocar a senha e confirmar a senha. Depois de redefinida a senha, o usuário deve ser direcionado para a tela de login.

**Tarefas**:
- [ ] Criar componente de redefinição de senha
- [ ] Implementar campo de nova senha
- [ ] Implementar campo de confirmação de senha
- [ ] Implementar validação de senhas (devem ser iguais)
- [ ] Implementar validação de força da senha
- [ ] Integrar com Supabase Auth (update password)
- [ ] Implementar redirecionamento para login após sucesso
- [ ] Implementar tratamento de erros
- [ ] Validar token do link de recuperação

---

### 5. Criar sidebar do sistema

**Status**: ⏳ Pendente

**Descrição**: A sidebar deve ter as opções:

- **Pessoas** (Expansível)
  - Colaboradores
  - Parceiros
  - Prestadores de Serviço
  - Clientes
- Contratos
- Timesheet
- Despesas
- Financeiro
- Dashboard
- PDI
- Relatórios

**Regras**:
- Os itens do menu devem aparecer de acordo com as permissões de cada colaborador
- Verificar permissões via RBAC (schema `core`)

**Tarefas**:
- [ ] Criar componente de Sidebar
- [ ] Implementar menu expansível "Pessoas"
- [ ] Implementar itens do menu
- [ ] Integrar com sistema de permissões (RBAC)
- [ ] Implementar verificação de permissões por item
- [ ] Implementar navegação entre telas
- [ ] Adicionar ícones aos itens do menu
- [ ] Implementar estado ativo do item selecionado
- [ ] Adicionar responsividade (mobile)

---

### 6. Criar tela com a lista de colaboradores

**Status**: ⏳ Pendente

**Descrição**: Tela deve ter uma lista com os colaboradores e uma barra de pesquisa que busca por nome, e-mail ou CPF.

Na lista deve aparecer:
- Nome
- E-mail
- WhatsApp
- Cargo

Ações disponíveis:
- Visualizar
- Editar
- Desativar
- Ativar
- Ver avaliação de PDI

**Tarefas**:
- [ ] Criar componente de lista de colaboradores
- [ ] Implementar tabela/listagem de colaboradores
- [ ] Implementar barra de pesquisa (nome, e-mail, CPF)
- [ ] Implementar filtros de busca
- [ ] Implementar ações: Visualizar, Editar, Desativar, Ativar, Ver PDI
- [ ] Integrar com Edge Function para buscar colaboradores
- [ ] Implementar paginação (se necessário)
- [ ] Implementar ordenação por colunas
- [ ] Adicionar loading state
- [ ] Implementar tratamento de erros
- [ ] Adicionar permissões (verificar se usuário pode visualizar/editar)

---

### 7. Criar a tela de cadastro de colaboradores

**Status**: ⏳ Pendente

**Descrição**: Tela deve conter campos para preenchimento dos dados do colaborador, além das permissões. Ao selecionar o cargo do usuário, o cargo já tem setado algumas permissões padrões e deve ser possível customizar as permissões.

**Regras**:
- O cadastro do colaborador deve:
  1. Criar um usuário no `auth.users` (Supabase Auth)
  2. Criar registro na tabela `people.colaboradores`
  3. Associar roles/permissões no schema `core`
  4. Disparar e-mail com senha de acesso (via Edge Function + Resend)
- Não deve ser permitido criar um colaborador com o mesmo e-mail
- Validações: CPF, e-mail, OAB (se advogado)

**Tarefas**:
- [ ] Criar componente de formulário de cadastro
- [ ] Implementar todos os campos do colaborador:
  - [ ] Dados pessoais (nome, CPF, data nascimento, etc.)
  - [ ] Dados de contato (e-mail, WhatsApp, endereço)
  - [ ] Dados profissionais (cargo, área, categoria, OAB)
  - [ ] Dados financeiros (salário, banco, etc.)
  - [ ] Benefícios
- [ ] Implementar seleção de cargo
- [ ] Implementar carregamento de permissões padrão do cargo
- [ ] Implementar customização de permissões
- [ ] Implementar validações (CPF, e-mail único, OAB se advogado)
- [ ] Criar Edge Function para cadastro:
  - [ ] Validar permissões do usuário
  - [ ] Criar usuário no `auth.users`
  - [ ] Criar colaborador no banco
  - [ ] Associar roles/permissões
  - [ ] Registrar log de auditoria
  - [ ] Enviar e-mail com senha (Resend)
- [ ] Integrar formulário com Edge Function
- [ ] Implementar tratamento de erros
- [ ] Implementar feedback de sucesso
- [ ] Adicionar máscaras de input (CPF, telefone, etc.)

---

### 8. Criar a tela de edição de colaboradores

**Status**: ⏳ Pendente

**Descrição**: Tela deve ter todos os campos para edição do colaborador.

**Regras**:
- Se alterado o e-mail, é necessário:
  1. Alterar na tabela `auth.users`
  2. Ajustar no banco de dados na tabela `people.colaboradores`
- Validações: CPF, e-mail único, OAB (se advogado)
- Não permitir editar colaborador inativo (ou permitir apenas reativação)

**Tarefas**:
- [ ] Criar componente de formulário de edição
- [ ] Implementar carregamento dos dados do colaborador
- [ ] Implementar todos os campos editáveis
- [ ] Implementar validações
- [ ] Criar Edge Function para edição:
  - [ ] Validar permissões do usuário
  - [ ] Atualizar colaborador no banco
  - [ ] Se e-mail alterado, atualizar `auth.users`
  - [ ] Registrar log de auditoria
- [ ] Integrar formulário com Edge Function
- [ ] Implementar tratamento de erros
- [ ] Implementar feedback de sucesso
- [ ] Adicionar confirmação para alterações críticas

---

## Regras Gerais da Sprint

### Edge Functions

**REGRA IMPORTANTE**: Toda interação do sistema com banco de dados deve passar por uma Edge Function que vai:
- Validar questões de acesso (permissões)
- Cadastrar logs de auditoria
- Aplicar regras de negócio
- Garantir segurança e integridade dos dados

### Autenticação

- Usar Supabase Auth para autenticação
- Integrar com `auth.users` do Supabase
- Implementar JWT tokens para sessões

### Permissões

- Usar sistema RBAC do schema `core`
- Verificar permissões antes de cada ação
- Exibir/ocultar elementos da UI baseado em permissões

### Auditoria

- Registrar todas as ações importantes em `core.audit_logs`
- Incluir: usuário, ação, dados anteriores, dados novos, timestamp

---

## REGRAS IMPORTANTES

- Todas as interações do front com o banco de dados deve passar por uma Edge Functions criada no Supabase
- Usar Resend para envio de e-mails
- Seguir padrões de design do sistema (shadcn/ui)
- Implementar tratamento de erros em todas as telas
- Adicionar loading states onde necessário
- Implementar validações tanto no frontend quanto no backend

---

## Histórico de Conclusão

_Atividades concluídas serão movidas para esta seção com data de conclusão._
