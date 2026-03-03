# PRD - Sprint de Ajustes (Pessoas, Contratos, Solicitações e Timesheet)

## 1. Problema
Os módulos atuais têm lacunas de cadastro e usabilidade que geram retrabalho operacional: ausência de tela de fornecedores, falta de padronização de campos entre categorias de pessoas, fluxo de timesheet com seleção pouco eficiente, ausência de templates de lançamento e inconsistências em campos de caso/contrato.

## 2. Objetivo de negocio
Padronizar os cadastros, reduzir tempo de lançamento operacional e aumentar consistência de dados em Pessoas, Contratos e Timesheet, sem quebrar fluxos já existentes.

## 3. Publico-alvo
- Administrativo/Financeiro
- Sócios e gestores
- Advogados e revisores que lançam timesheet
- Equipe de cadastro (CRM e contratos)

## 4. Metricas de sucesso
- M-001: 100% das categorias de pessoas com campo `conta_contabil` disponível em dados básicos.
- M-002: Redução de pelo menos 30% no tempo médio de preenchimento de timesheet (baseline atual vs pós-sprint).
- M-003: 0 regressões de criação/edição em Colaborador, Prestador, Parceiro e Cliente após deploy.
- M-004: 100% dos fluxos de Caso com rótulos e estados de reajuste/CAP conforme regra “Possui? Sim/Não”.

## 5. Escopo (in / out)
### In scope
- Nova tela de `Fornecedores` com mesmos campos de `Prestadores de Serviço`.
- Novo campo `Conta Contábil` em dados básicos de: Colaborador, Prestador, Parceiro, Fornecedor e Cliente.
- Novo campo em Colaboradores: `Dados profissionais > Skills` (lista).
- Ajustes no Caso:
  - Pergunta `Possui reajuste?` com card Sim/Não e exibição condicional.
  - `Período de reajuste` com primeira opção `Não tem`.
  - `Índice de reajuste` com primeira opção `Não tem`.
  - Pergunta para `CAP desejado de horas` com card Sim/Não e opção `Não tem`.
  - Botão `Atualizar contrato` alterado para `Atualizar caso` na tela de caso.
- Solicitação de contrato:
  - Campo de seleção de cliente.
  - Pré-cadastro com criação de rascunho de contrato vinculado ao cliente selecionado.
- Timesheet:
  - Fluxo de seleção: `Cliente` (busca) -> `Caso` -> `Contrato` preenchido automaticamente.
  - Campo de duração em minutos (substitui horas no input principal).
  - Templates de lançamento com `CommandSelect`, filtráveis por `Categoria` e por texto.
  - Preenchimento assistido do template com dados de cliente/contrato/caso quando disponíveis.
- Reconciliação de dados entre `Fluxo de faturamento` e `Revisão de fatura`:
  - Mesma regra de agregação de horas/itens/valor.
  - Mesma semântica de consolidação de timesheet por caso.
  - Mesma base de cálculo para totais de cliente/contrato/caso e total geral.

### Out of scope
- Motor de IA para geração automática de texto jurídico.
- Importação em lote de templates via planilha.
- Reestruturação completa de permissões do módulo de pessoas.
- Integração externa com ERP contábil para sincronizar conta contábil.

## 6. Requisitos funcionais
- RF-001: O sistema deve disponibilizar menu e tela de `Fornecedores` com paridade funcional de cadastro/listagem/edição/ativação equivalente a `Prestadores de Serviço`.
- RF-002: O campo `conta_contabil` deve existir e ser persistido nas entidades de Colaborador, Prestador, Parceiro, Fornecedor e Cliente.
- RF-003: O campo `conta_contabil` deve ser exibido na aba de dados básicos em todos os formulários das categorias acima.
- RF-004: Em Colaboradores, deve existir campo `skills` (lista), com múltiplos valores e persistência na edição.
- RF-005: No Caso, deve existir card Sim/Não para `Possui reajuste?`; quando `Não`, ocultar campos de reajuste e gravar estado explícito de ausência.
- RF-006: No Caso, o campo `período de reajuste` deve ter opção inicial `Não tem`.
- RF-007: No Caso, o campo `índice de reajuste` deve ter opção inicial `Não tem`.
- RF-008: No Caso, deve existir controle Sim/Não para `CAP desejado de horas`; quando `Não`, ocultar/limpar valor de CAP.
- RF-009: O botão de edição do caso deve exibir texto `Atualizar caso`.
- RF-010: Na Solicitação de Contratos, deve existir campo obrigatório de cliente.
- RF-011: Ao concluir pré-cadastro de solicitação com cliente selecionado, o sistema deve criar (ou atualizar) contrato em `rascunho` já vinculado ao cliente.
- RF-012: No Timesheet, o usuário deve selecionar primeiro cliente (com busca), depois caso, e o contrato deve ser preenchido automaticamente a partir do caso selecionado.
- RF-013: O campo de duração do timesheet deve aceitar minutos e persistir corretamente em formato numérico consistente no backend.
- RF-014: O formulário de timesheet deve oferecer `CommandSelect` de templates, com filtro por categoria e por texto do template.
- RF-015: Ao selecionar template, o descritivo deve preencher o campo de descrição com placeholders substituíveis por dados de contexto (cliente/contrato/caso).
- RF-016: `Fluxo de faturamento` e `Revisão de fatura` devem retornar os mesmos totais de `itens`, `horas` e `valor` para o mesmo conjunto de filtros/status.
- RF-017: A consolidação de timesheet por caso deve ser consistente nas duas telas (sem dupla contagem de horas/itens).
- RF-018: Em divergência detectada por regra antiga de agregação, o sistema deve priorizar a fonte reconciliada e apresentar valores idênticos nas duas visões.

## 7. Requisitos nao funcionais
- RNF-001: Migrações de banco devem ser backward-compatible e sem uso do schema `public` para novas tabelas de domínio.
- RNF-002: Todas as novas APIs/edge functions devem validar autenticação JWT e permissões vigentes do usuário.
- RNF-003: Campos novos devem aparecer no frontend sem quebra de layout em desktop e mobile.
- RNF-004: A busca de cliente/caso e templates no timesheet deve responder em p95 <= 500ms para até 5k registros por tenant.
- RNF-005: Operações de criação de rascunho de contrato via solicitação devem ser transacionais.
- RNF-006: Alterações de schema/campos devem manter type-check do frontend sem erros.
- RNF-007: A reconciliação entre telas deve ser determinística e idempotente para o mesmo snapshot de dados.

## 8. Riscos
- R-001: Divergência de modelo entre `fornecedores` e `prestadores` | Impacto: alto | Mitigação: reutilizar schema/DTO/componentes de prestadores e criar camada de mapeamento explícita.
- R-002: Ambiguidade no armazenamento de minutos vs horas | Impacto: alto | Mitigação: definir unidade canônica (minutos) e conversão centralizada no backend/frontend.
- R-003: Criação automática de rascunho duplicado por solicitação | Impacto: médio | Mitigação: regra idempotente por solicitação + cliente e checagem prévia de rascunho aberto.
- R-004: Regressão nos formulários legados de pessoas | Impacto: médio | Mitigação: testes de regressão por entidade e validação manual guiada.
- R-005: Uso incorreto de templates com placeholders vazios | Impacto: baixo | Mitigação: fallback textual e destaque de campos pendentes no formulário.
- R-006: Divergência de agregação entre telas do faturamento | Impacto: alto | Mitigação: centralizar regra de cálculo e validar igualdade por contrato/caso em teste de regressão.

## 9. Criterios de aceite
- CA-001: É possível criar, editar e listar fornecedores com os mesmos campos de prestadores (RF-001).
- CA-002: `Conta Contábil` aparece e persiste em Colaborador, Prestador, Parceiro, Fornecedor e Cliente (RF-002, RF-003).
- CA-003: Colaborador permite gerenciar `Skills` em lista na aba de dados profissionais (RF-004).
- CA-004: Caso exibe corretamente controles Sim/Não e opções `Não tem` para reajuste e CAP, com persistência consistente (RF-005, RF-006, RF-007, RF-008).
- CA-005: Botão de edição do caso mostra `Atualizar caso` (RF-009).
- CA-006: Solicitação de contrato exige cliente e gera rascunho pré-vinculado sem duplicidade indevida (RF-010, RF-011).
- CA-007: No timesheet, fluxo cliente -> caso -> contrato automático funciona com busca e sem seleção manual de contrato (RF-012).
- CA-008: Duração em minutos é salva corretamente e refletida em listagens/edição (RF-013).
- CA-009: Templates de descritivo funcionam com filtro por categoria/texto e preenchimento assistido (RF-014, RF-015).
- CA-010: `npm run -s type-check` sem erros e smoke test dos módulos ajustados concluído (RNF-003, RNF-006).
- CA-011: Para os mesmos filtros/status, `Fluxo de faturamento` e `Revisão de fatura` exibem totais idênticos de itens/horas/valor (RF-016, RF-017, RF-018).
