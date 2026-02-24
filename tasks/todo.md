# TODO

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
