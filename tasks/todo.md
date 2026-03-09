# TODO

## Sprint Planejada - Ajustes Pessoas, Contratos, Solicitações e Timesheet

### Contexto resumido
Implementar ajustes de cadastro e UX em quatro áreas críticas (`Pessoas`, `Contratos`, `Solicitações de Contrato`, `Timesheet`) para reduzir retrabalho operacional, padronizar dados e acelerar lançamento.

### Entregáveis
- [ ] Entregável 1: Módulo `Fornecedores` com paridade de campos/fluxo de Prestadores.
- [ ] Entregável 2: Campo `Conta Contábil` adicionado em todas as categorias de pessoas.
- [ ] Entregável 3: Campo `Skills` (lista) em dados profissionais de Colaboradores.
- [ ] Entregável 4: Ajustes de UX/regra na tela de Caso (reajuste, índice, CAP e rótulo do botão).
- [ ] Entregável 5: Solicitação de contrato com seleção de cliente e pré-rascunho vinculado.
- [ ] Entregável 6: Novo fluxo de seleção no Timesheet + duração em minutos + templates de descritivo.
- [ ] Entregável 7: Reconciliação de dados entre `Fluxo de faturamento` e `Revisão de fatura`.

### Plano de implementação (itens verificáveis)
- [ ] Modelar entidade/tela de `Fornecedores` reutilizando base de prestadores (schema, RPCs, edge functions e UI).
- [ ] Adicionar coluna/campo `conta_contabil` nas entidades de pessoas necessárias e atualizar payloads de create/update/get.
- [ ] Atualizar formulários de Colaborador, Prestador, Parceiro, Fornecedor e Cliente para exibir `Conta Contábil` em dados básicos.
- [ ] Adicionar campo `skills` (lista) no cadastro de colaboradores e persistência em create/update/get.
- [x] Implementar no Caso card `Possui reajuste?` (sim/não) com renderização condicional dos campos de reajuste.
- [x] Ajustar opções padrão para `Período de reajuste` e `Índice de reajuste` com primeira opção `Não tem`.
- [x] Implementar controle sim/não para `CAP desejado de horas` com opção `Não tem` e limpeza de valor quando desativado.
- [x] Alterar label do botão de edição do caso para `Atualizar caso`.
- [x] Inserir campo de cliente na abertura de solicitação de contrato com validação obrigatória.
- [x] Implementar criação idempotente de rascunho de contrato pré-vinculado ao cliente ao concluir pré-cadastro.
- [x] Solicitação de contrato: popup com campos `Cliente`, `Nome`, `Proposta` e criação imediata de contrato em `rascunho`
- [ ] Refatorar fluxo do Timesheet para seleção sequencial: cliente -> caso -> contrato automático.
- [ ] Alterar input de duração do timesheet para minutos e garantir conversão/persistência consistente.
- [ ] Criar catálogo de templates de descritivo com categoria e texto, carregado em `CommandSelect`.
- [ ] Implementar filtro dos templates por categoria e busca textual no mesmo seletor.
- [ ] Implementar preenchimento assistido de placeholders do template com dados do cliente/caso/contrato selecionado.
- [x] Unificar regra de agregação de `itens/horas/valor` entre telas de `Fluxo de faturamento` e `Revisão de fatura`.
- [x] Ajustar consolidação de timesheet por caso para evitar dupla contagem em qualquer uma das telas.
- [x] Revisar RPCs/edge functions de listagem para garantir mesma fonte de verdade nos totais agregados.
- [x] Corrigir fallback numérico da revisão (`||` -> nullish) para preservar zero revisado/aprovado e eliminar divergência com fluxo.
- [x] Revisão de cliente: popup com abas por contrato e subabas por item, com abertura direta da revisão por item/timesheet

### Plano de validação (testes, logs, verificações)
- [ ] Executar testes de criação/edição para cada categoria de pessoas com `conta_contabil`.
- [ ] Validar persistência de `skills` em colaborador (create, update e reload da tela).
- [ ] Validar cenários do Caso com combinações sim/não para reajuste e CAP.
- [ ] Validar geração de rascunho por solicitação com cliente e comportamento idempotente.
- [ ] Validar fluxo completo de timesheet com seleção cliente->caso->contrato auto.
- [ ] Validar armazenamento de minutos e exibição correta em listagem/edição.
- [ ] Validar templates: busca por categoria/texto e preenchimento automático de contexto.
- [ ] Executar validação cruzada por contrato/caso comparando os totais entre `Fluxo de faturamento` e `Revisão de fatura`.
- [x] Executar `npm run -s type-check`.
- [ ] Executar smoke test manual das telas: Pessoas, Caso, Solicitações e Timesheet.

### Revisão final
- [ ] Confirmar aderência ao PRD em `docs/prd.md` (RF/RNF/CA).
- [x] Confirmar migrations e edge functions aplicadas no ambiente via MCP.
- [ ] Confirmar ausência de regressão nas funcionalidades já existentes de Prestadores, Parceiros, Clientes e Contratos.

## Sprint Atual - Correção Timesheet na Revisão de Fatura
- [x] Backend: persistir linhas de revisão de timesheet em `operations.timesheets` (create/update) quando revisão for aberta a partir de item não-timesheet
- [x] Backend: adicionar `horas_revisadas` e `horas_aprovadas` em `operations.timesheets`
- [x] Backend: evitar sobrescrever horas/valores do item de regra financeira quando `review_mode = timesheet`
- [x] Backend: criar/atualizar `finance.billing_items` de origem `timesheet` para as linhas persistidas
- [x] Backend: registrar auditoria detalhada em `core.audit_logs` + `finance.billing_item_audit`
- [x] Frontend: enviar `review_mode = timesheet` no save do modal quando aplicável
- [x] Revisão: executar `npm run -s type-check`

## Fase 1 - Bug crítico
- [x] Corrigir loading infinito da sidebar com múltiplas abas

## Fase 2 - Prestador de Serviço
- [x] Tornar responsável obrigatório
- [x] Adicionar CPF
- [x] Adicionar telefone
- [x] Adicionar endereço

## Fase 3 - Casos (escopo principal)
- [x] Dados básicos: contencioso/consultivo
- [x] Suportar múltiplas regras de cobrança
- [x] CAP desejado (quantidade de horas)
- [x] Migrar aba indicação para regras de negócio e vincular por regra de cobrança
- [x] Cross sell (sim/não + origem colaborador)
- [x] Número de processos (default 1)
- [x] Persistir serviço no caso (servico_id) e retornar em RPCs
- [x] Validar aprovadores como sócios no backend

## Fase 4 - Contrato
- [ ] Solicitação de abertura de contrato (advogado/admin/sócio)
- [ ] Novo status contrato: em análise
- [ ] Forma de entrada (Orgânico/Prospecção)

## Fase 5 - Timesheet (nova feature)
- [ ] Listar, cadastrar, editar timesheet por contrato/caso
- [ ] Fluxo de status: em lançamento, revisão, aprovado

## Revisão
- [x] Executar type-check local
- [ ] Executar lint (bloqueado por wizard interativo do Next no ambiente)
- [x] Aplicar migration de múltiplas regras financeiras por caso no Supabase (MCP)
- [x] Validar estrutura no banco: coluna `regras_financeiras`, RPCs e backfill legado

- [x] Ajustar UX de múltiplas regras de cobrança no caso: cards, remover só rascunho, encerrar/reativar

## Fase 6 - Indicação + remoção de número de processos
- [x] `Pagamento da indicação` em cards (sim/não)
- [x] `Indicado por` em `CommandSelect` com busca e agrupamento
- [x] Ocultar campos de indicação quando pagamento = não
- [x] Incluir `prestadores` e `parceiros` nas opções do formulário
- [x] Remover `numero_processos` do frontend (contrato/caso)
- [x] Sanitizar payloads de criação/edição para remover `numero_processos`
- [x] Aplicar migration de limpeza histórica no Supabase (MCP)

## Revisão Fase 6
- [x] Executar type-check local
- [ ] Executar build (bloqueado por rede no ambiente: falha ao baixar Google Fonts)

## Sprint Atual - Solicitações + Timesheet
- [x] Banco: criar módulo de solicitação de abertura de contrato
- [x] Banco: adicionar status `em_analise` em `contracts.contratos`
- [x] Banco: adicionar campo `forma_entrada` em `contracts.contratos` (orgânico/prospecção)
- [x] Banco: criar permissões para solicitação de contrato (read/write/manage)
- [x] Banco: criar módulo de timesheet (tabela + permissões + RPCs)
- [x] Edge functions: solicitações (listar, criar, concluir, vincular contrato)
- [x] Edge functions: timesheet (listar, criar, editar, mudar status)
- [x] Frontend: tela de Solicitação de Contratos (visão usuário e visão admin/sócio)
- [x] Frontend: incluir `forma_entrada` no formulário de contrato (novo/editar)
- [x] Frontend: fluxo de contrato com status `em_analise` (ativação mantendo a aprovação por ação de status)
- [x] Frontend: telas de Timesheet (lista, cadastro, edição) e regras de status por perfil
- [x] Revisão: type-check + smoke test de permissões por inspeção de regras e queries MCP

## Revisão Sprint Atual
- [x] Validado acesso MCP (sem uso do schema `public`)
- [x] Validada existência de tabelas/colunas/permissões: `contracts.solicitacoes_contrato`, `operations.timesheets`, `contracts.contratos.status`, `contracts.contratos.forma_entrada`, permissões `contracts.solicitacoes.*` e `operations.timesheet.*`
- [x] Validado type-check do frontend após ajustes (`npm run -s type-check`)

## Sprint Atual - Clique para abrir anexo em Solicitações
- [x] Backend: permitir leitura de anexo de solicitação na edge `get-anexo`
- [x] Frontend: tornar anexo da tabela de solicitações clicável para visualização
- [x] Revisão: type-check local

## Sprint Atual - Menu expansível de Faturamento
- [x] Sidebar: substituir item único "Financeiro" por menu expansível "Faturamento"
- [x] Sidebar: incluir subitens `Itens a faturar`, `Fluxo de faturamento`, `Revisão de fatura`, `Notas geradas`
- [x] Breadcrumb: mapear novos segmentos de rota de faturamento
- [x] Revisão: type-check local

## Contexto resumido
Implementar módulo de faturamento fase 1 com fluxo completo (itens a faturar -> revisão -> aprovação -> faturado), snapshot editável por caso, prevenção de dupla cobrança, permissões finas e integração com timesheet e regras financeiras sem emissão real de boleto/NF nesta fase.

## Entregáveis
- [ ] Entregável 1: Modelo de dados de faturamento (lotes, itens, snapshots, auditoria, notas)
- [ ] Entregável 2: Permissões finas do módulo de faturamento
- [ ] Entregável 3: Edge functions do fluxo (`itens`, `iniciar`, `revisar`, `aprovar`, `faturar`, `notas`)
- [ ] Entregável 4: UI `Itens a faturar` com árvore Cliente > Contrato > Caso e ações em massa
- [ ] Entregável 5: UI `Fluxo de faturamento` e `Revisão de fatura` por caso/regra financeira
- [ ] Entregável 6: UI `Notas geradas` com rastreabilidade de artefatos
- [ ] Entregável 7: Ajustes finais de timesheet (escopo por usuário, filtros e consistência de atualização)

## Plano de implementação (itens verificáveis)
- [ ] Criar migrations para tabelas de domínio de faturamento fora do schema `public`.
- [ ] Criar campos sequenciais por tenant para lote, item faturável e nota gerada.
- [ ] Implementar constraints e índices para evitar dupla cobrança e melhorar performance de filtros.
- [ ] Implementar transições de estado do fluxo sem estado `reprovado` (com `cancelado`).
- [ ] Implementar lock de item por `billing_batch_id` e rollback seguro em cancelamento.
- [ ] Implementar snapshot faturável independente dos dados mestre (contrato/caso).
- [ ] Persistir `horas_informadas`, `horas_revisadas`, `horas_aprovadas` por item faturável.
- [ ] Implementar auditoria de alterações campo a campo no fluxo de revisão/aprovação.
- [ ] Criar permissões finas do módulo (`read`, `write`, `review`, `approve`, `revert`, `manage` por etapa).
- [ ] Ajustar RPCs/edge functions para respeitar permissões e tenant em todas as ações.
- [ ] Implementar tela `Itens a faturar` com filtro por período livre e ações por contrato/cliente.
- [ ] Implementar envio para revisão alterando timesheet incluído para status `revisao`.
- [ ] Implementar tela `Fluxo de faturamento` com progresso por etapa.
- [ ] Implementar tela `Revisão de fatura` com edição pontual de snapshot por caso e regra financeira.
- [ ] Implementar aprovação por cadeia de aprovadores do caso.
- [ ] Implementar etapa final `Faturar` com popup de desconto monetário e rateio de pagadores.
- [ ] Implementar tela `Notas geradas` com metadados e links de artefatos (placeholders boleto/NF).
- [ ] Ajustar botão “Ir para contrato” nas solicitações para navegar com filtro pré-aplicado.
- [ ] Garantir bloqueio de novos lançamentos em contrato/caso encerrados.
- [ ] Ajustar campo `forma_entrada` do contrato em todas as telas de novo/edição/visualização.

## Sprint Atual - Faturamento (passo 2)
- [x] Criar edge `start-faturamento` (RPC `start_faturamento_flow`)
- [x] Criar edge `get-fluxo-faturamento` (RPC `get_fluxo_faturamento`)
- [x] Tela `Itens a faturar`: ação para enviar cliente/contrato para revisão
- [x] Tela `Fluxo de faturamento`: listar lotes reais com filtro por status
- [x] Revisão: `npm run -s type-check`

## Sprint Atual - Correção Itens a Faturar (valores fixos)
- [ ] Ajustar RPC `get_itens_a_faturar` para consolidar horas + mensal + mensalidade de processo + projeto + êxito
- [ ] Ajustar RPC `start_faturamento_flow` para inserir itens de regras financeiras (não apenas timesheet)
- [ ] Aplicar migration no MCP (sem schema public)
- [ ] Validar em UI que contratos com mensal/projeto aparecem com `Valor em aberto` > 0 mesmo sem horas

## Sprint Atual - Correção Fluxo de Faturamento
- [x] Remover overload legado `public.get_fluxo_faturamento(varchar, uuid)` para evitar ambiguidade de RPC

## Plano de validação (testes, logs, verificações)
- [ ] Validar cenários de concorrência para envio simultâneo de itens ao fluxo.
- [ ] Validar que o mesmo item não pode ser faturado duas vezes.
- [ ] Validar retorno de etapa (pré-revisão e pós-revisão com permissão).
- [ ] Validar que revisão/aprovação alteram apenas snapshot e não o cadastro base.
- [ ] Validar alteração de status de timesheet ao entrar no fluxo.
- [ ] Validar filtros por intervalo de datas, contrato, caso e status.
- [ ] Validar permissões por perfil com testes de API (acesso permitido e negado).
- [ ] Executar `npm run -s type-check`.
- [ ] Executar testes de regressão das telas de contrato/caso/timesheet.

## Revisão final
- [ ] Confirmar PRD aplicado sem divergência de escopo.
- [ ] Confirmar deploy de migrations e edge functions no ambiente alvo.
- [ ] Confirmar smoke test das 4 telas de faturamento com dados reais de homologação.

## Sprint Atual - Revisão de Fatura
- [x] Banco: criar RPC para listar itens/lotes em revisão com snapshot editável por caso/regra
- [x] Banco: criar RPC para atualizar snapshot de revisão (somente revisão/aprovação)
- [x] Banco: criar RPC para transição de etapa (revisão -> aprovação e retorno)
- [x] Edge function: `get-revisao-fatura`
- [x] Edge function: `update-revisao-fatura-item`
- [x] Edge function: `set-revisao-fatura-status`
- [x] Frontend: substituir placeholder de `/financeiro/revisao-de-fatura` por tela funcional
- [x] Frontend: filtro por status/lote/cliente/contrato/caso + tabela expansível
- [x] Frontend: edição pontual de snapshot e ações de avançar/retornar etapa
- [x] Frontend: ação `Revisar` com pop-up em abas (`Timesheet` e `Valores`) para revisor/aprovador
- [x] Refactor: remover dependência de lote no envio para revisão (fluxo por item)
- [x] Revisão: executar `npm run -s type-check`
- [x] Deploy MCP: migrations + edge functions da sprint de revisão

## Sprint Atual - Ajuste Revisão Timesheet
- [x] Refatorar modal de revisão para tabela multi-linha com CRUD de timesheet
- [x] Manter horas iniciais imutáveis e editar horas revisadas por linha
- [x] Permitir edição de profissional, data, atividade e valor/hora por linha
- [x] Persistir `timesheet_itens_revisao` no snapshot e recalcular totais na gravação
- [x] Exibir aba `Valores` apenas para itens não-timesheet
- [x] Revisão: executar `npm run -s type-check`

- [x] Remover tabs do modal de revisão e renderizar conteúdo único por tipo (`timesheet` vs `regra_financeira`)
- [x] Regra financeira: revisar por tabela de itens/parcelas com soma de valor revisado

## Sprint Atual - Correção Valor em Aberto na Revisão
- [x] Frontend: usar valor efetivo por status (`aprovado > revisado > informado`) em todos os agregados/exibições
- [x] Frontend: evitar persistência indevida de `0` ao avançar item sem edição explícita de valor
- [x] Revisão: executar `npm run -s type-check`

## Sprint Atual - Correções de UX/Permissão Faturamento
- [x] Exibir responsável atual de revisão/aprovação diretamente na RPC de revisão de fatura
- [x] Melhorar UX do `CommandSelect` para seleção de colaborador (dropdown mais largo/rolagem adequada)
- [x] Bloquear edição de itens aprovados/faturados/cancelados no modal de revisão
- [x] Permitir visualização de timesheets de outros usuários para perfis com `operations.timesheet.manage`
- [x] Fluxo de faturamento: exibir regra financeira (em vez de cliente) e adicionar filtro por caso
- [x] Revisão: executar `npm run -s type-check`

## Sprint Atual - Solicitação -> Contrato (Proposta em Anexos)
- [x] RPC `create_solicitacao_contrato`: ao criar rascunho, copiar anexo "Proposta" também para `contracts.contrato_anexos`
- [x] Backfill: copiar anexos antigos de solicitação para contratos rascunho já vinculados sem anexo correspondente
- [x] Publicar edge function `create-solicitacao-contrato` com fallback consistente de cópia de anexos

## Sprint Atual - Ajustes Fluxo Faturamento + E2E
- [x] Itens a faturar: seleção múltipla de clientes/contratos/casos para envio em lote ao fluxo
- [x] Itens a faturar: abas/filtros por tipo de regra financeira (hora, mensalidade processo, mensalidade, projeto, projeto parcelado, êxito)
- [ ] Revisão de fatura: permitir transferir timesheet para outro caso (com contrato coerente)
- [x] Revisão de fatura: admin pode editar revisores/aprovadores diretamente na tela
- [x] Revisão de fatura: reforçar bloqueio de edição para itens aprovados
- [x] E2E: criar suíte contrato/timesheet/itens/revisão/aprovação por cada regra financeira
- [x] E2E: criar cenário com múltiplas regras no mesmo caso
- [x] E2E: validar visibilidade por perfil (itens ausentes e ações indevidas)
- [x] Revisão: executar `npm run -s type-check`
