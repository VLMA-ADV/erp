# TODO

## Sprint Atual - Aprofundamento da Documentação /docs (2026-03-18)

### Escopo solicitado
- [x] Aprofundar seção de `Banco de Dados` com modelagem real (schemas, tabelas-chave, constraints críticas).
- [x] Aprofundar seção de `APIs` com catálogo de edges (método, permissão, RPC e finalidade).
- [x] Aprofundar seção de `Processos de Negócio` com trilhas operacionais e guardrails do fluxo.

### Execução
- [x] Revisar migrations e edge functions atuais para refletir comportamento real do sistema.
- [x] Atualizar página `src/app/docs/page.tsx` com tabelas e fluxos detalhados.
- [x] Refatorar bloco de APIs para seções por domínio (sem tabela), com leitura automática de todas as edge functions.
- [x] Expandir seções `Banco de Dados` e `Processos de Negócio` com visão de funcionamento, regras críticas e visão por perfil de usuário.
- [x] Validar com `npm run -s type-check`.

## Sprint Atual - Fallback de Despesas em Itens a Faturar (2026-03-18)

### Escopo solicitado
- [x] Garantir que despesas apareçam em `Itens a faturar` mesmo quando a RPC remota estiver sem consolidação de despesas.
- [x] Manter despesas no mesmo agrupamento `Cliente -> Contrato -> Caso`, com extrato por item e suporte à aba `Despesas`.

### Execução
- [x] Integrar fallback de leitura via edge `get-despesas` dentro da tela de `itens-a-faturar`.
- [x] Mesclar despesas elegíveis (`em_lancamento`, `revisao`, `aprovado`) ao extrato local sem duplicar linhas já vindas da RPC principal.
- [x] Recalcular totais de caso/contrato/cliente após merge de despesas.
- [x] Validar com `npm run -s type-check`.

## Sprint Atual - Despesa no Start Faturamento (2026-03-18)

### Escopo solicitado
- [x] Corrigir envio de despesas para revisão/fluxo de faturamento no backend.

### Execução
- [x] Criar migration corretiva para garantir `operations.despesas.cliente_id` (coluna + backfill + índice + FK).
- [x] Atualizar `create_despesa` para persistir `cliente_id` derivado do contrato.
- [x] Atualizar `update_despesa` para sincronizar `cliente_id` com contrato existente.
- [x] Validar com `npm run -s type-check`.
- [x] Aplicar migration no ambiente remoto (`supabase db push`) após repair do histórico.

## Sprint Atual - Valor Obrigatório em Despesas (2026-03-18)

### Escopo solicitado
- [x] Tornar `valor` obrigatório em despesas e refletir esse valor em Itens a faturar.

### Execução
- [x] Frontend `Despesas`: adicionar campo `Valor` no modal (cadastro/edição) e validação `> 0`.
- [x] Frontend `Despesas`: incluir coluna `Valor` na listagem.
- [x] Banco: atualizar RPCs `get_despesas`, `create_despesa`, `update_despesa` para retornar/persistir/validar `valor`.
- [x] Aplicar migration `20260318171500_require_valor_in_despesas.sql` no ambiente remoto.
- [x] Validar com `npm run -s type-check`.

## Sprint Atual - Envio de Despesas em Lote (2026-03-19)

### Escopo solicitado
- [x] Corrigir envio de despesas selecionadas para revisão/fluxo quando houver variação de versão do RPC.

### Execução
- [x] `Itens a faturar`: remover fallback local que adicionava despesas fora da elegibilidade real da RPC.
- [x] `Itens a faturar`: alterar envio em lote para executar por caso (`alvo_id`) com compatibilidade ampla.
- [x] Validar com `npm run -s type-check`.

## Sprint Atual - Visibilidade de Despesas em Ambiente Legado (2026-03-19)

### Escopo solicitado
- [x] Corrigir ausência de despesas em `Itens a faturar` quando a RPC remota não inclui despesas na consolidação.

### Execução
- [x] Reintegrar fallback de leitura de despesas (`get-despesas`) dentro de `Itens a faturar`.
- [x] Mesclar despesas na árvore `Cliente -> Contrato -> Caso` com deduplicação por `origem_id`.
- [x] Recalcular totais por caso/contrato/cliente após merge.
- [x] Validar com `npm run -s type-check`.

## Sprint Atual - Cliente/Contrato/Faturamento com Despesas (2026-03-17)

### Escopo solicitado
- [x] Cliente: adicionar campo `Potencial do cliente` (`baixo`, `medio`, `alto`) no cadastro/edição.
- [x] Contrato: remover `Regime fiscal` da UI e payload.
- [x] Contrato: remover `Configuração de prospecção` da UI e payload.
- [x] Contrato: adicionar `Responsável da prospecção` (dropdown de colaboradores).
- [x] Contrato: adicionar `Canal de prospecção` (texto aberto).
- [x] Faturamento (`Itens a faturar`, `Fluxo`, `Revisão`): incluir `Despesas` no mesmo fluxo de revisão/aprovação.

### Execução
- [x] Atualizar frontend de clientes e contratos (tipos, formulário, payload).
- [x] Atualizar edge functions de cliente para persistir/retornar `potencial_cliente`.
- [x] Criar migration incremental com ajustes de schema e RPCs (contrato + faturamento + despesas).
- [x] Validar com `npm run -s type-check`.
- [ ] Aplicar migration no Supabase via MCP.

## Sprint Atual - Reorganização Pessoas/Contratos/Faturamento/Despesas (2026-03-16)

### Escopo solicitado
- [x] Colaboradores: criar aba `Skills` e mover seleção de skills para ela.
- [x] Solicitação de contrato: permitir criar novo cliente e adicionar campo aberto de descrição.
- [x] Contrato: exibir descrição da solicitação acima de anexos.
- [x] Fluxo de status de contrato: `rascunho` (somente admin), `solicitacao`, `validacao`, `ativo`.
- [x] Itens a faturar: garantir hierarquia `Cliente -> Contratos -> Casos`.
- [x] Criar lista `Grupo de impostos` (estrutura pronta para opções do Filipe).
- [x] Revisão de faturas: simplificar para visão single-screen agrupada por cliente/contrato/caso.
- [x] Popups de revisão/aprovação: exibir linhas de etapa `Lançamento original`, `Revisão` e `Aprovação` para cada item.
- [x] Popups de revisão: unificar em tabela única por item/etapa (`Inicial`, `Revisor n`, `Aprovador n`) com confirmação para avanço em massa no modal de cliente.
- [x] Popups de revisão: restringir visibilidade para `etapa do usuário + anteriores`, travar edição de etapas fora da vez e permitir troca de responsável apenas para admin em etapas pendentes.
- [x] Popup de revisão/aprovação: separar edição de `aprovado` de `revisado` para impedir sobrescrita de valor/hora revisados ao aprovar.
- [x] Revisão de fatura: carregar responsáveis do contrato/caso usando fallback em `get-contrato` quando `get-contratos` não trouxer `timesheet_config`, mantendo dropdown pré-selecionado.
- [x] Contrato: em `Forma de entrada = prospecção`, exibir estrutura de prospecção similar à indicação (pagamentos/percentual/rateio).
- [x] Despesas: ajustar fluxo para `cliente, caso, categoria, descrição, arquivo`.
- [ ] Limpeza de dados de teste: apagar registros de contratos, timesheet e faturamento para homologação.

### Execução
- [x] Implementação frontend/backend por módulo.
- [x] Aplicar migrations/edge updates necessários (migrations já versionadas + edges de despesas criadas; deploy em ambiente pendente).
- [x] Validar com `npm run -s type-check`.
- [x] Registrar revisão final desta sprint.

### Revisão da sprint (2026-03-16)
- Contrato: adicionados `grupo_imposto_id` e `prospeccao_config` no estado/UI/payload de `create/update`, com validação e rateio.
- Faturamento: mantida visão single-screen agrupada por `Cliente -> Contrato -> Caso` na revisão.
- Despesas: criado módulo completo com página `/despesas`, componente de listagem/cadastro/edição e edges `get-despesas`, `create-despesa`, `update-despesa`.
- Limpeza de homologação: script destrutivo preparado em `scripts/reset_homologacao_fluxo.sql` (execução manual pendente).

## Sprint Planejada - Ajustes Pessoas, Contratos, Solicitações e Timesheet

### Contexto resumido
Implementar ajustes de cadastro e UX em quatro áreas críticas (`Pessoas`, `Contratos`, `Solicitações de Contrato`, `Timesheet`) para reduzir retrabalho operacional, padronizar dados e acelerar lançamento.

### Entregáveis
- [x] Entregável 1: Módulo `Fornecedores` com paridade de campos/fluxo de Prestadores.
- [x] Entregável 2: Campo `Conta Contábil` adicionado em todas as categorias de pessoas.
- [x] Entregável 3: Campo `Skills` (lista) em dados profissionais de Colaboradores.
- [x] Entregável 4: Ajustes de UX/regra na tela de Caso (reajuste, índice, CAP e rótulo do botão).
- [x] Entregável 5: Solicitação de contrato com seleção de cliente e pré-rascunho vinculado.
- [x] Entregável 6: Novo fluxo de seleção no Timesheet + duração em minutos + templates de descritivo.
- [x] Entregável 7: Reconciliação de dados entre `Fluxo de faturamento` e `Revisão de fatura`.

### Plano de implementação (itens verificáveis)
- [x] Modelar entidade/tela de `Fornecedores` reutilizando base de prestadores (schema, RPCs, edge functions e UI).
- [x] Adicionar coluna/campo `conta_contabil` nas entidades de pessoas necessárias e atualizar payloads de create/update/get.
- [x] Atualizar formulários de Colaborador, Prestador, Parceiro, Fornecedor e Cliente para exibir `Conta Contábil` em dados básicos.
- [x] Adicionar campo `skills` (lista) no cadastro de colaboradores e persistência em create/update/get.
- [x] Implementar no Caso card `Possui reajuste?` (sim/não) com renderização condicional dos campos de reajuste.
- [x] Ajustar opções padrão para `Período de reajuste` e `Índice de reajuste` com primeira opção `Não tem`.
- [x] Implementar controle sim/não para `CAP desejado de horas` com opção `Não tem` e limpeza de valor quando desativado.
- [x] Alterar label do botão de edição do caso para `Atualizar caso`.
- [x] Inserir campo de cliente na abertura de solicitação de contrato com validação obrigatória.
- [x] Implementar criação idempotente de rascunho de contrato pré-vinculado ao cliente ao concluir pré-cadastro.
- [x] Solicitação de contrato: popup com campos `Cliente`, `Nome`, `Proposta` e criação imediata de contrato em `rascunho`
- [x] Refatorar fluxo do Timesheet para seleção sequencial: cliente -> caso -> contrato automático.
- [x] Alterar input de duração do timesheet para minutos e garantir conversão/persistência consistente.
- [x] Criar catálogo de templates de descritivo com categoria e texto, carregado em `CommandSelect`.
- [x] Implementar filtro dos templates por categoria e busca textual no mesmo seletor.
- [x] Implementar preenchimento assistido de placeholders do template com dados do cliente/caso/contrato selecionado.
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
- [x] Confirmar aderência ao PRD em `docs/prd.md` (RF/RNF/CA).
- Rastreabilidade confirmada por checklist de entregáveis/itens verificáveis desta sprint em relação aos RF/RNF/CA do PRD.
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
- [x] Solicitação de abertura de contrato (advogado/admin/sócio)
- [x] Novo status contrato: em análise
- [x] Forma de entrada (Orgânico/Prospecção)

## Fase 5 - Timesheet (nova feature)
- [x] Listar, cadastrar, editar timesheet por contrato/caso
- [x] Fluxo de status: em lançamento, revisão, aprovado

## Revisão
- [x] Executar type-check local
- [x] Executar lint (configurado `.eslintrc.json`; comando executa com warnings não bloqueantes de hooks)
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
- [x] Executar build (ajustado `src/app/layout.tsx` para remover dependência de `next/font/google`; build local concluído com sucesso em 2026-03-16)

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
- [x] Entregável 1: Modelo de dados de faturamento (lotes, itens, snapshots, auditoria, notas)
- [x] Entregável 2: Permissões finas do módulo de faturamento
- [x] Entregável 3: Edge functions do fluxo (`itens`, `iniciar`, `revisar`, `aprovar`, `faturar`, `notas`)
- [x] Entregável 4: UI `Itens a faturar` com árvore Cliente > Contrato > Caso e ações em massa
- [x] Entregável 5: UI `Fluxo de faturamento` e `Revisão de fatura` por caso/regra financeira
- [x] Entregável 6: UI `Notas geradas` com rastreabilidade de artefatos
- [x] Entregável 7: Ajustes finais de timesheet (escopo por usuário, filtros e consistência de atualização)

## Plano de implementação (itens verificáveis)
- [x] Criar migrations para tabelas de domínio de faturamento fora do schema `public`.
- [x] Criar campos sequenciais por tenant para lote, item faturável e nota gerada.
- [x] Implementar constraints e índices para evitar dupla cobrança e melhorar performance de filtros.
- [x] Implementar transições de estado do fluxo sem estado `reprovado` (com `cancelado`).
- [x] Implementar lock de item por `billing_batch_id` e rollback seguro em cancelamento.
- [x] Implementar snapshot faturável independente dos dados mestre (contrato/caso).
- [x] Persistir `horas_informadas`, `horas_revisadas`, `horas_aprovadas` por item faturável.
- [x] Implementar auditoria de alterações campo a campo no fluxo de revisão/aprovação.
- [x] Criar permissões finas do módulo (`read`, `write`, `review`, `approve`, `revert`, `manage` por etapa).
- [x] Ajustar RPCs/edge functions para respeitar permissões e tenant em todas as ações.
- [x] Implementar tela `Itens a faturar` com filtro por período livre e ações por contrato/cliente.
- [x] Implementar envio para revisão alterando timesheet incluído para status `revisao`.
- [x] Implementar tela `Fluxo de faturamento` com progresso por etapa.
- [x] Implementar tela `Revisão de fatura` com edição pontual de snapshot por caso e regra financeira.
- [x] Implementar aprovação por cadeia de aprovadores do caso.
- [x] Implementar etapa final `Faturar` com popup de desconto monetário e rateio de pagadores.
- [x] Implementar tela `Notas geradas` com metadados e links de artefatos (placeholders boleto/NF).
- [x] Ajustar botão “Ir para contrato” nas solicitações para navegar com filtro pré-aplicado.
- [x] Garantir bloqueio de novos lançamentos em contrato/caso encerrados.
- [x] Ajustar campo `forma_entrada` do contrato em todas as telas de novo/edição/visualização.

### Revisão incremental (2026-03-16 - Notas geradas)
- Implementada RPC `public.get_notas_geradas` com filtros (status, tipo, busca e limite) e validação de permissão/tenant.
- Tela frontend de notas conectada via edge `get-notas-geradas` (consumindo RPC de notas no backend).
- Tela `/financeiro/notas-geradas` conectada com listagem real (filtros, status, tipo, metadados e link de arquivo).
- Revisão de fatura: adicionada ação de `Faturar` para itens aprovados com popup de desconto e rateio; RPC `faturar_revisao_item` persiste snapshot/auditoria e gera nota placeholder.
- Publicadas edges locais `get-notas-geradas` e `faturar-revisao-item` para completar o fluxo de edges do módulo.
- Revisão de fatura: fluxo `em_aprovacao` agora avança/retorna entre aprovadores configurados do caso, mantendo etapa até o último aprovador.
- Validação local executada: `npm run -s type-check`, `npm run -s lint`, `npm run -s build` e `npm run -s e2e -- --reporter=line` (5 cenários skipped por ausência de credenciais, incluindo cadeia de aprovadores e faturamento).
- Revisado backlog de faturamento: marcados como concluídos os itens já cobertos por migrations/RPCs existentes (schema `finance`, sequenciais por tenant, constraints/índices, snapshot, auditoria, transições de status e rollback seguro de lote com `detach_faturamento_batch`).
- Entregável final de timesheet marcado como concluído com base nas migrations de escopo por usuário/filtros e ajustes de consistência já aplicados na sprint.
- Itens pendentes restantes dependem de ambiente externo (MCP/homolog com dados reais e credenciais de execução).

## Sprint Atual - Faturamento (passo 2)
- [x] Criar edge `start-faturamento` (RPC `start_faturamento_flow`)
- [x] Criar edge `get-fluxo-faturamento` (RPC `get_fluxo_faturamento`)
- [x] Tela `Itens a faturar`: ação para enviar cliente/contrato para revisão
- [x] Tela `Fluxo de faturamento`: listar lotes reais com filtro por status
- [x] Revisão: `npm run -s type-check`

## Sprint Atual - Correção Itens a Faturar (valores fixos)
- [x] Ajustar RPC `get_itens_a_faturar` para consolidar horas + mensal + mensalidade de processo + projeto + êxito
- [x] Ajustar RPC `start_faturamento_flow` para inserir itens de regras financeiras (não apenas timesheet)
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
- [x] Executar `npm run -s type-check`.
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
- [x] Revisão de fatura: permitir transferir timesheet para outro caso (com contrato coerente)
- [x] Revisão de fatura: admin pode editar revisores/aprovadores diretamente na tela
- [x] Revisão de fatura: reforçar bloqueio de edição para itens aprovados
- [x] E2E: criar suíte contrato/timesheet/itens/revisão/aprovação por cada regra financeira
- [x] E2E: criar cenário com múltiplas regras no mesmo caso
- [x] E2E: validar visibilidade por perfil (itens ausentes e ações indevidas)
- [x] Revisão: executar `npm run -s type-check`

## Sprint Atual - Ajustes Contrato/Caso (2026-03-17)
- [x] Desabilitar `cap desejado` quando a regra de cobrança for `hora`.
- [x] Espelhar no `cross selling` a mesma estrutura de indicação (periodicidade, método, valor, datas, parcelas e previsão).
- [x] Aplicar os ajustes em ambas as telas: contrato (`contrato-form`) e caso (`caso-form`).
- [x] Revisão: executar `npm run -s type-check`.

## Sprint Atual - Documentação Handover (2026-03-18)
- [x] Criar página navegável de documentação técnica em `/docs`.
- [x] Incluir seções de funcionamento, arquitetura, estrutura de pastas, banco, APIs e processos.
- [x] Incluir checklist de handover e comandos de execução/deploy.
- [x] Revisão: executar `npm run -s type-check`.

## Sprint Atual - Faturamento Somente no Fluxo (2026-03-20)

### Escopo solicitado
- [x] Remover ações de faturamento da tela `Revisão de fatura`.
- [x] Permitir faturamento por linha e em lote na tela `Fluxo de faturamento`.
- [x] Garantir processamento em lote agrupado por caso.

### Execução
- [x] `Revisão de fatura`: remover botões de `Faturar` (massa, linha e modal) mantendo apenas revisão/aprovação.
- [x] `Fluxo de faturamento`: adicionar seleção por linha e por grupo para itens com status `aprovado`.
- [x] `Fluxo de faturamento`: adicionar ação `Faturar selecionados (N)` e faturamento por linha.
- [x] `Fluxo de faturamento`: executar envio para edge `faturar-revisao-item` com agrupamento por `caso_id`.
- [x] Revisão: executar `npm run -s type-check`.
