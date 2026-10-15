# Entregas de outubro/2026: briefing para implementação

Este briefing traz o escopo fechado com o cliente (respostas de 14/10/2026). Ele não tem pontos em aberto, exceto os marcados **[CONFIRMAR]**.

- Documento do cliente: https://claude.ai/artifact/6JFJA3zaavrmma2joCA9sj
- Versão técnica: `docs/especificacao-demandas-2026-10.md`, na branch `claude/determined-bell-ab9pgg`

Todos os caminhos são relativos à raiz do repositório. As referências de linha são aproximadas e foram levantadas no commit `3676733`.

## Regras gerais

- **Um PR por entrega**, na ordem abaixo. A cada entrega:
  1. Aplicar as migrations e publicar as edge functions em produção.
  2. Publicar o frontend.
  3. Rodar o Playwright contra produção.
- **Testes em produção:**
  - Usar só dados de um cliente fictício, "ZZ Teste Claude", e limpar ao final.
  - **Nunca** emitir NFS-e, registrar boleto ou mexer em kit ou fatura de cliente real.
  - O PDF do relatório pode ser gerado no cliente de teste.
- **Antes de alterar uma função SQL**, salvar a versão atual de produção com `pg_get_functiondef`. Várias funções e tabelas não estão no repo: `toggle_contrato_status`, o `CREATE TABLE` de `contracts.contratos`, de `operations.timesheets` e de `finance.billing_*`.
- **Convenções:** seguir `tasks/lessons.md`. Commits e PRs no padrão `fix(area): …` / `feat(area): …`.

---

## Entrega 1: C1 + F2, navegação entre caso e contrato, e atalho para o caso (só frontend)

### C1. "Voltar" do caso leva ao contrato

**Situação atual:**
- `src/components/contratos/caso-form.tsx`:
  - "Cancelar" usa `router.back()` (~:3798).
  - Salvar e excluir fazem `router.push('/contratos/${contratoId}/editar')` (~:1701, :1736) e caem na etapa Dados.
- `src/components/contratos/contrato-form.tsx`: na etapa Casos, "Voltar para lista" e "Cancelar" fazem `router.push('/contratos')` (~:2975, :5651), e a lista perde o contexto.
- `src/components/contratos/contratos-list.tsx`:
  - Já lê `?search=` e `?contrato_id=` no carregamento (~:66, :82-89). `contrato_id` expande o contrato.
  - Busca, `filtroRegra`, `filtroSituacao` e o estado de expansão são `useState` locais e não vão para a URL.

**O que fazer:**
1. Em `caso-form`, Voltar, Cancelar, Salvar e Excluir navegam por **rota fixa** para `/contratos/{contratoId}/editar?step=casos`:
   - acrescentar `&view=1` quando o caso estava em modo visualização;
   - **não** usar `router.back()`, porque o caso também é aberto em nova aba pela F2, sem histórico.
2. Em `contrato-form`, "Voltar para lista" e "Cancelar" vão para `/contratos?contrato_id={id}`, preservando os filtros que vieram da lista (ver item 3).
   - Ao carregar com `contrato_id`, rolar até o contrato (`scrollIntoView`) além de expandi-lo.
3. Em `contratos-list`, sincronizar busca, `filtroRegra` e `filtroSituacao` com a query string (ler no load, `router.replace` ao mudar, sem empilhar histórico).
   - Os links de visualizar e editar contrato e caso devem carregar esses parâmetros para poder voltar a eles.
4. O ajuste vale para a etapa Casos do contrato e para a tela do caso: rotas `casos/novo` e `casos/[casoId]/editar`.

**Aceite (Playwright):**
- Buscar um contrato, abri-lo, entrar num caso e clicar em Voltar mostra a etapa Casos do mesmo contrato.
- Clicar em "Voltar para lista" mostra a lista com a busca preservada e o contrato expandido e visível.
- Salvar um caso volta para a etapa Casos.

### F2. Ícone "abrir caso em nova aba" no faturamento

**Situação atual:** o caso aparece só como texto, sem link.
- Revisão: `src/components/faturamento/revisao-de-fatura-list.tsx` ~:3546-3556.
- Composição: `composicao/types.ts` `labelCaso` ~:461, usado em `composicao/cliente-card.tsx` ~:307.
- Fila: dentro do mesmo componente de revisão.

**O que fazer:**
- Ao lado do nome do caso na Fila, na Revisão e na Composição, um ícone (lucide `ExternalLink`) como `<a href="/contratos/{contrato_id}/casos/{caso_id}/editar?view=1" target="_blank" rel="noopener">`.
  - Deve ser link de verdade, para clique do meio e Ctrl/Cmd+clique funcionarem.
  - O clique não pode expandir nem recolher o grupo: usar `stopPropagation`.
  - O `contrato_id` existe em `billing_items`; garantir que chega ao componente.
- Esconder o ícone para quem não tem permissão de ver contratos.
- O cliente **não** quer atalho para o contrato. Da tela do caso, o Voltar (C1) leva ao contrato.

**Aceite:**
- Clicar no ícone abre uma nova aba com o caso em modo visualização.
- A aba do faturamento não muda.
- Na nova aba, Voltar leva à etapa Casos do contrato.

---

## Entrega 2: C2, contrato novo já nasce ativo

**Situação atual:**
- `contrato-form.tsx`:
  - `ensureDraftCreated` (~:2089-2104) cria o contrato como `rascunho` ao avançar para Casos.
  - No salvar final (~:2596-2613), se há caso salvo e o status é `rascunho`, chama `toggle-contrato-status` com `em_analise` ("validação").
- Funções de banco e edge:
  - DB `public.create_contrato` (`supabase/migrations/20260428160000_…sql:59-66`) promove `rascunho` → `em_analise` quando o payload tem casos.
  - Edge `create-contrato` normaliza o status via `_shared/contrato-status.ts`; o espelho no cliente é `src/lib/contracts/contrato-status.ts`.
  - Edge `toggle-contrato-status` checa a permissão `contracts.contratos.write`, chama a RPC `toggle_contrato_status` (não está no repo) e grava auditoria.
- O timesheet só lista contratos `ativo` (`src/components/timesheet/timesheet-list.tsx` ~:442).
- **Bug:** em `src/components/contratos/contratos-actions.tsx` ~:29-30 e :132-160, `isPreActiveStatus` não inclui `rascunho`. O botão mostra "Encerrar contrato?" em vermelho, mas envia `ativo`.

**O que fazer:**
1. No salvar final com **≥1 caso salvo**, o contrato vai para **`ativo`**, não `em_analise`. Sem caso, continua `rascunho`.
   - Fazer a mudança no frontend **e** no `create_contrato`: promover para `ativo` quando houver casos.
   - Manter o registro de auditoria da mudança de status.
2. Contratos criados a partir de **solicitação de contrato** também nascem `ativo`.
   - Ver o fluxo de conversão em `src/components/contratos/solicitacoes-contrato-list.tsx` (~:664) e a edge/RPC correspondente.
3. **Qualquer usuário** com permissão de cadastrar contrato pode gerar contrato ativo. Não criar permissão nova.
4. Corrigir `contratos-actions.tsx`: `rascunho` deve se comportar como pré-ativo (texto "Ativar contrato?", ícone e cor de ativar).
5. **Ativação em lote dos contratos hoje em `validacao`/`em_analise`:**
   - Gerar a lista com id, número, cliente, data e criador.
   - **Enviar ao usuário para conferência antes de executar.**
   - Depois do OK, executar o update em lote via `toggle_contrato_status`, para manter a auditoria.

**Aceite:**
- Criar um contrato com 1 caso e salvar deixa o status em Ativo, e o caso aparece no seletor do timesheet.
- Sair antes de adicionar casos deixa o contrato em Rascunho.
- O botão de um rascunho mostra "Ativar".

---

## Entrega 3: T2, minutos de 5 em 5

**Situação atual:**
- Em `timesheet-list.tsx` ~:958-994, Horas e Minutos são `type="number" step="1"`, com minutos de 0 a 60 (60 aceito).
- `computeMinutosTotal` está em ~:121-126.
- "Auxiliado por IA" tem campos próprios (~:1022-1047).
- O backend usa `create_timesheet` (última versão em `20260731180000_timesheet_cargo_snapshot.sql`) e as edges `create-timesheet` / `update-timesheet`.

**O que fazer:**
1. Minutos vira um select com `00, 05, …, 55`. Horas continua livre.
   - Mesmo tratamento para os minutos de IA.
   - Remover a aceitação de 60.
2. Validação no servidor (`create_timesheet`, `update_timesheet`) e nas edges:
   - `duracao_minutos % 5 = 0` e `ia_minutos % 5 = 0`;
   - **só na criação e quando a duração for alterada** na edição.
3. Lançamentos antigos não são alterados nem arredondados.
   - Ao editar um antigo fora do padrão sem mexer no tempo, salvar normalmente.
   - O select deve exibir o valor legado, por exemplo 07, como opção desabilitada ou rótulo, até o usuário trocar.

**Aceite:**
- Não é possível salvar 1h07: a UI não oferece e a API recusa.
- 1h05 e 0h55 salvam.
- Editar só a descrição de um lançamento antigo de 7 min salva sem erro.

---

## Entrega 4: R2 + R4 + R3, competência, linhas ocultas e pagadores no relatório

**Arquivos:**
- PDF: `src/lib/utils/timesheet-report-pdf.ts` (testes em `timesheet-report-pdf.test.ts`). O único chamador é `gerarRelatorio` em `src/components/faturamento/composicao-da-fatura-list.tsx` ~:535-586.
- Prévia HTML: `src/lib/utils/timesheet-report.ts` (botão em `revisao-de-fatura-list.tsx` ~:3706).
- Competência:
  - helpers em `src/lib/faturamento/competencia.ts` e `composicao/types.ts` (`labelCompetenciaCurta` ~:388);
  - a competência do kit é `date_trunc('month', billing_items.periodo_inicio)`;
  - `timesheets.periodo_faturamento` = mês seguinte ao `data_lancamento` (`20260831120000_periodo_faturamento_mes_seguinte.sql`).

### R2. Competência = mês do serviço

**O que fazer:**
- Nos documentos ao cliente (relatório de timesheet, NFS-e e nota de débito), a "Competência" passa a ser o **mês de execução**.
  - Para horas e despesas, é o mês do `data_lancamento`, ou seja, a competência do kit − 1 mês.
  - Exibir abaixo "Período: 01/MM/AAAA a DD/MM/AAAA".
  - "Emissão" continua sendo a data de geração.
- **A regra do ERP não muda:** horas e despesas do mês M continuam faturadas no ciclo M+1, e as demais regras seguem o próprio mês. Não mexer em `periodo_faturamento`, no gerador nem no `kits.competencia`. A mudança é só no que os documentos exibem.
- NFS-e e nota de débito usam a mesma competência exibida. Localizar onde a competência é montada no payload da NFS-e (edge `emit-nfse`) e na nota de débito.
- **[CONFIRMAR]** Para mensalidades, o cliente respondeu "mês anterior também, mas isso é apenas para controle do cliente". Interpretação adotada: os documentos de mensalidade também exibem o mês anterior ao do kit. Se for ambíguo na implementação, perguntar ao usuário.

### R4. Linhas ocultas

**O que fazer:**
- O PDF e a prévia não imprimem:
  - linhas com 0h (horas revisadas ou aprovadas = 0);
  - itens excluídos (`cancelado`);
  - itens **ignorados** (`status = 'ignorado'`).
- Hoje as linhas vêm de `composicao-da-fatura-list.tsx` ~:536-555 e do snapshot `timesheet_itens_revisao`. Filtrar ali e também no gerador, por segurança.
- Os totais devem ser recalculados sobre as linhas visíveis.

### R3. "Faturado a" com todos os pagadores

**Situação atual:**
- Já existe "Faturado a" no cabeçalho (PR #443).
- Os pagadores ficam em `casos.pagadores_servico` [{cliente_id, percentual}], com override por kit em `kits.ajustes`.
- O PDF tem o bloco "Divisão por pagador" no fim (~:453-473), omitido com pagador único.

**O que fazer:**
- No cabeçalho, "Faturado a: Nome A (60%) · Nome B (40%)". Com pagador único: "Nome (100%)".
- Manter a divisão de valores no rodapé.
- **Um relatório único**, nunca um por pagador.

**Aceite:**
- Testes unitários no `timesheet-report-pdf.test.ts` para:
  - competência exibida = mês anterior ao do kit, para horas;
  - linhas 0h e ignoradas omitidas;
  - cabeçalho com 2 pagadores e percentuais.
- Teste em produção: no cliente ZZ, gerar o PDF de um kit com uma linha de 0h, uma ignorada e dois pagadores.

---

## Entrega 5: R1 + R5 + R6, numeração, valor fixo e quadro de impostos

### R1. Número do documento

**O que fazer:**
1. Criar **uma sequência por tipo de documento**, por tenant, **contínua** (sem reinício anual). Por exemplo, a tabela `finance.documento_sequencias(tenant_id, tipo, ultimo)` com uma RPC atômica `proximo_numero_documento(tipo)`.
2. Tipos:
   - `relatorio_timesheet` → "Timesheet N";
   - relatório de despesas → "Despesas N";
   - `nota_debito` → "Nota de débito N".
3. A NFS-e mantém o número da própria nota ("NF 127812").
4. Gravar o número em `billing_notes.numero` (a coluna já existe) na **primeira** geração.
   - **Regerar mantém o número.** Hoje `registrar_documento_kit` (`src/lib/faturamento/documentos-kit.ts` ~:140-189) cancela a nota anterior e cria outra; a nova deve reaproveitar o número da anterior do mesmo kit e tipo.
5. Exibir no cabeçalho, junto de Emissão e Competência.

### R5. Valor fixo no relatório

**Situação atual:** o PDF só usa itens `origem_tipo='timesheet'`. Em casos de valor fixo (mensal, mensalidade de processo ou carteira, projeto, pró-labore) as linhas saem a R$ 0,00 e o total sai R$ 0,00. Os itens `regra_financeira` nunca entram.

**O que fazer:**
- Quando o kit tiver item de regra financeira de valor fixo:
  - as linhas de timesheet continuam com data, profissional, descrição e tempo, **sem a coluna Valor** (sem "R$ 0,00");
  - incluir um bloco com o(s) valor(es) fixo(s) e a origem, por exemplo "Mensalidade setembro/2026 — R$ 6.476,52" ou "Projeto X — parcela 2/5 — R$ …";
  - o Total mostra as horas somadas e o valor = fixo + horas cobradas à parte (excedente), se houver, discriminando as partes.
- Usar o valor aprovado do item (`valor_aprovado → valor_revisado → valor_informado`, conforme `tasks/lessons.md`), não recalcular a partir do snapshot.
- Casos só de horas continuam como hoje, com a coluna Valor.

### R6. Quadro de impostos

**O que fazer:**
- Abaixo do total, quadro no formato do sistema Law: Honorários, COFINS, CSLL, IRRF, PIS, Total a pagar.
- **Reutilizar exatamente o cálculo da NFS-e** em `src/components/faturamento/nfse-preview-dialog.tsx` ~:12-60:
  - alíquotas: IRRF 1,5%, PIS 0,65%, COFINS 3%, CSLL 1%;
  - mínimos e regras por grupo tributário, inclusive o override em `kits.ajustes`.
  - Extrair esse cálculo para um helper compartilhado, por exemplo `src/lib/faturamento/retencoes.ts`, e usar nos dois lugares.
- Com vários pagadores, **um quadro por pagador**, com a base = parte do pagador e a retenção dele.
- Pagador sem retenção: mostrar só Honorários e Total a pagar.
- Exibir **também na prévia** (antes da NFS-e), com os valores estimados.

**Aceite:**
- Testes unitários para:
  - numeração: sequência por tipo, e regerar mantém o número;
  - caso mensal: sem coluna valor, com bloco de valor fixo e total correto;
  - quadro de impostos batendo com o `nfse-preview-dialog` para os mesmos dados;
  - dois pagadores geram dois quadros.

---

## Entrega 6a: F3, aprovação automática de projetos

**Situação atual:**
- Fluxo: fila → Liberar → `em_revisao` → `em_aprovacao` → `aprovado` → `faturado`.
- Transições em `set_revisao_fatura_status` (`20260806210000_aprovacao_em_grupo.sql`), que grava o histórico `revisao_fatura_itens_historico` e `billing_item_audit`.
- Liberar/gerar fica em `start_faturamento_flow` (`20260928100000_liberar_selecionados_e_devolver_para_aprovacao.sql`).
- Não existe autoaprovação.

**O que fazer:**
1. Ao liberar da fila, os itens abaixo vão direto para **`aprovado`**:
   - itens `regra_financeira` de modalidade **`projeto`** (parcela única ou parcelado);
   - itens `timesheet` de **casos cuja regra é projeto**.
   - Não incluir pró-labore, mensalidades, êxito, horas de outros casos nem despesas.
2. Preencher `valor_revisado` e `valor_aprovado` com o valor informado.
   - Gravar histórico e auditoria com a ação "aprovação automática – regra projeto" e o ator sistema, ou o usuário que liberou com flag `automatico=true`.
   - Recalcular o status do lote.
3. Item autoaprovado pode ser devolvido (`retornar`) normalmente.
4. Se o valor de um item de projeto for alterado manualmente, ele volta ao fluxo normal de revisão.

**Aceite:**
- No cliente ZZ, com um caso de projeto, uma parcela e horas, Liberar deixa tudo em Aprovado, com o registro de aprovação automática.
- Um caso mensal no mesmo lote continua em revisão.

## Entrega 6b: T1, sugestões para repetir lançamento

**O que fazer:**
1. Criar a RPC `get_sugestoes_timesheet(p_caso_id uuid default null)`. Ela retorna até **5** sugestões:
   - lançamentos do **próprio usuário** (`created_by = auth.uid()`) dos **últimos 90 dias**;
   - agrupados por (`caso_id`, descrição normalizada com trim e lower, `duracao_minutos`) e ordenados por frequência, depois pelo mais recente;
   - com cliente, caso, descrição, duração e contagem;
   - excluindo casos inativos e contratos não ativos;
   - com `p_caso_id`, filtrar por esse caso.
2. No diálogo "Novo timesheet" (`timesheet-list.tsx`, `openCreate` ~:535), um bloco "Repetir lançamento" com as sugestões.
   - Clicar numa sugestão preenche caso, descrição e duração, com a data de hoje. **Não salva sozinho.**
   - Recarregar as sugestões quando o caso mudar.
3. Ação **Duplicar** em cada linha de "Meus lançamentos": abre o form preenchido com a data de hoje.
4. Fora do escopo: "repetir a semana passada".

**Aceite:** com o usuário de teste, criar 3 lançamentos iguais no caso ZZ. Abrir "Novo" mostra a sugestão no topo, e clicar preenche o form sem salvar.

## Entrega 6c: F1, lixeira (etapa 1)

**Situação atual:**
- "Excluir da fila" usa `excluir_timesheets_do_faturamento` (`20260812100000_excluir_da_fila_de_faturar.sql`). A função grava `timesheets.excluido_faturamento`, `_por`, `_em` e `_motivo`, é reversível com `p_excluir=false` e não tem tela.
- A UI chama em `revisao-de-fatura-list.tsx` ~:2771 e `itens-a-faturar-list.tsx` ~:775.

**O que fazer:**
1. **Escopo:** só os itens excluídos da fila. **Itens ignorados NÃO entram.** Timesheets e despesas apagados nas telas de lançamento ficam para a etapa 2, porque hoje são hard delete.
2. Nova aba **Lixeira** em `/financeiro/faturamento`:
   - colunas: data, cliente, caso, profissional, descrição, horas, valor estimado, excluído por, excluído em, motivo;
   - filtros: competência, cliente, caso, excluído por;
   - seleção múltipla.
3. Ao excluir da fila, abrir um diálogo pedindo o **motivo** (opcional). Hoje é enviado `null`.
4. **Restaurar** (individual ou em lote) chama `excluir_timesheets_do_faturamento(p_excluir=false)` ou uma RPC nova `restaurar_da_lixeira`:
   - o item volta para a fila da competência original;
   - se essa competência já foi faturada, vai para a competência aberta atual e a UI avisa;
   - registrar quem restaurou e quando.
5. **Permissão nova** `finance.faturamento.lixeira.restore`:
   - quem não a tem vê a lixeira, mas o botão Restaurar fica oculto;
   - conceder a: **sócios, Bruna Fedatto, Cines, Larissa Quadros, Jessika** e **[CONFIRMAR o nome do usuário que respondeu "e eu"]**;
   - localizar os usuários por nome no banco e confirmar a lista com o usuário antes de conceder.
6. **Retenção de 12 meses:** itens excluídos há mais de 12 meses não aparecem na lixeira e não podem ser restaurados. Basta filtrar por `excluido_faturamento_em`; não apagar dados.

**Aceite:**
- Excluir 3 lançamentos ZZ da fila com motivo faz com que apareçam na Lixeira com autor, data e motivo.
- Restaurar faz com que voltem para a fila.
- Um usuário sem a permissão não vê o botão Restaurar.

---

## Encerramento

- Atualizar o documento do cliente marcando cada entrega como publicada.
- Enviar ao usuário um resumo curto por entrega, com prints do Playwright.
- Só interromper o usuário para:
  - a lista de ativação em lote da C2;
  - a lista de usuários com permissão de restaurar da F1;
  - os pontos **[CONFIRMAR]**.
