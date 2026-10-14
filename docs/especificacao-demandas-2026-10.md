# Especificação — demandas de outubro/2026

Documento para alinhar com o cliente **o que** cada demanda entrega, **como funciona hoje** no ERP e **o que precisa de resposta** antes do desenvolvimento.

Cada item traz:
- **Hoje:** o comportamento atual, levantado no código.
- **Proposta:** o comportamento novo.
- **Critérios de aceite:** como validar a entrega.
- **Perguntas ao cliente:** o que ainda falta decidir. As respostas sugeridas estão marcadas como *(sugestão)*.

Origem das demandas:
- Mensagem com a lista numerada (Contratos, Timesheet e Faturamento).
- PDF anotado do "Relatório de timesheet" da Construtora Strobel, competência outubro/2026. Os itens dele estão na seção **R**.

| # | Módulo | Demanda | Tamanho estimado |
|---|---|---|---|
| C1 | Contratos | "Voltar" da tela de casos retorna ao contrato | P |
| C2 | Contratos | Contrato novo já nasce ativo | P |
| T1 | Timesheet | Sugestões para repetir lançamentos frequentes | M |
| T2 | Timesheet | Minutos de 5 em 5 | P |
| F1 | Faturamento | Lixeira com restauração | M |
| F2 | Faturamento | Atalho para abrir o caso em outra janela | P |
| F3 | Faturamento | Aprovação automática (projeto e outras regras) | M |
| R1 | Relatório de timesheet | Número do documento | P |
| R2 | Relatório de timesheet | Competência correta | P |
| R3 | Relatório de timesheet | Todos os pagadores e percentuais no cabeçalho | P |
| R4 | Relatório de timesheet | Não imprimir linhas zeradas ou excluídas | P |
| R5 | Relatório de timesheet | Valor fixo no total dos relatórios de valor fechado | M |
| R6 | Relatório de timesheet | Memória de cálculo de impostos no rodapé | M |

---

## Contratos

### C1. "Voltar" da tela de casos retorna ao contrato

**Hoje:**
- Os casos são editados em `/contratos/{contrato}/casos/{caso}/editar`.
- Ao salvar ou excluir um caso, o sistema volta para o contrato, mas cai na etapa **Dados**, e não na etapa **Casos**.
- Na etapa Casos do contrato, os botões "Voltar para lista" e "Cancelar" levam à lista completa, `/contratos`.
- A lista perde busca, filtros e o contrato que estava expandido. Esses estados não ficam guardados na URL, então é preciso procurar o contrato de novo.

**Proposta:**
1. A partir de um caso (visualizar, editar ou novo), **Voltar**, **Cancelar**, **Salvar** e **Excluir** levam à **etapa Casos do mesmo contrato**. A rota é `/contratos/{id}/editar?step=casos`, mantendo o modo visualização (`view=1`) se for o caso.
2. Na etapa Casos, **Voltar para lista** abre a lista de contratos **com aquele contrato expandido e rolado até ele**. O mecanismo é `?contrato_id={id}`, que já existe e hoje só é usado pela tela de solicitações.
3. A busca e os filtros da lista (texto, regra e situação) passam a ficar na URL. Assim, voltar ou recarregar a página preserva o que estava filtrado.

**Critérios de aceite:**
- Abrir o contrato X, entrar no caso Y e clicar em Voltar mostra a lista de casos do contrato X.
- Salvar um caso volta para a lista de casos do contrato X, e não para a etapa Dados.
- Filtrar a lista por "Strobel", abrir um contrato e voltar mostra a lista ainda filtrada, com o contrato expandido.

**Perguntas ao cliente:**
- "Tela de casos" é a etapa Casos dentro do contrato ou a tela do caso individual? *(sugestão: tratamos as duas.)*

### C2. Contrato novo já nasce ativo

**Hoje:**
- Ao avançar da etapa Dados para Casos, o contrato é salvo como **rascunho**.
- Ao salvar com pelo menos um caso, ele passa para **validação**.
- A ativação é manual, pelo botão de liga/desliga na lista.
- Só contratos **ativos** aparecem no timesheet para lançamento de horas.

**Proposta:**
1. Ao concluir o cadastro, ou seja, ao salvar com **pelo menos um caso completo**, o contrato passa direto para **ativo**, sem a etapa de validação.
2. Enquanto não houver caso salvo, o contrato continua **rascunho**. Isso evita que um contrato vazio apareça no timesheet e no faturamento.
3. A troca de status fica registrada no log de auditoria, como já acontece na ativação manual.
4. O botão manual continua existindo para encerrar e reativar.
5. Correção junto: para contratos em rascunho, o botão hoje mostra "Encerrar contrato?" (vermelho), mas na verdade **ativa** o contrato. O texto e a cor passam a dizer "Ativar".

**Critérios de aceite:**
- Criar um contrato com um caso e salvar resulta em status Ativo, e o caso já aparece no timesheet.
- Criar um contrato e sair antes de cadastrar casos resulta em status Rascunho.

**Perguntas ao cliente:**
- Os contratos que estão hoje em **validação** devem ser ativados em lote? *(sugestão: sim, uma vez, com a lista revisada antes.)*
- Contratos que vêm de **Solicitação de contrato** também nascem ativos, ou ali a validação continua? *(sugestão: também ativos.)*
- Qualquer usuário com permissão de cadastrar contrato pode gerar um contrato já ativo? *(sugestão: sim; quem não puder ativar continua gerando rascunho.)*

---

## Timesheet

### T1. Sugestões para repetir lançamentos frequentes

**Hoje:**
- Não existe duplicar nem repetir lançamento.
- O mais próximo são os templates fixos de descrição.

**Proposta:**
1. No diálogo **Novo timesheet** há um bloco **"Repetir lançamento"** com até **5 sugestões**.
   - **Sem caso selecionado:** os lançamentos mais repetidos **do usuário** nos últimos **90 dias**, agrupados por caso, descrição e duração.
   - **Com caso selecionado:** os lançamentos mais frequentes **daquele caso** feitos pelo usuário.
   - Cada sugestão mostra cliente, caso, descrição resumida, duração e quantas vezes foi lançada.
2. Clicar numa sugestão **preenche o formulário** com caso, descrição e duração. A data é sempre **hoje** e pode ser editada.
   - Nada é salvo sem o usuário confirmar.
   - Não é lançamento automático.
3. Na lista "Meus lançamentos", cada linha ganha a ação **Duplicar**, que abre o formulário preenchido com a data de hoje.
4. Sugestões de casos inativos ou de contratos encerrados não aparecem.

**Critérios de aceite:**
- Um usuário que lançou 4 vezes "Revisão de contrato – 30min" no caso #446 vê essa sugestão no topo.
- Clicar nela abre o formulário preenchido e só salva quando o usuário confirma.

**Perguntas ao cliente:**
- As sugestões consideram só os lançamentos do próprio usuário ou também os dos colegas no mesmo caso? *(sugestão: só do usuário; os colegas viram uma segunda aba depois, se fizer falta.)*
- A janela de 90 dias e o limite de 5 sugestões atendem?
- Interessa também **"repetir a semana anterior"**, ou seja, copiar vários lançamentos de uma vez? *(sugestão: fica fora desta entrega.)*

### T2. Minutos de 5 em 5

**Hoje:**
- Os campos "Horas" e "Minutos" aceitam qualquer valor de 1 em 1 minuto, inclusive 60 minutos.
- A duração de "Auxiliado por IA" funciona igual.

**Proposta:**
1. O campo **Minutos** vira uma lista com as opções 00, 05, 10 … 55. Horas continua livre.
2. A mesma regra vale para os minutos de **Auxiliado por IA**.
3. O servidor passa a recusar duração que não seja múltipla de 5 em lançamentos novos e editados. Isso protege também a importação e a API.
4. Lançamentos antigos (ex.: 7 min) **não são alterados**. Se forem editados, o usuário precisa escolher um valor válido.

**Critérios de aceite:**
- Não é possível salvar 1h07.
- 1h05 e 0h55 salvam normalmente.

**Perguntas ao cliente:**
- Os lançamentos antigos fora do padrão devem ser arredondados? *(sugestão: não mexer no histórico.)*

---

## Faturamento

### F1. Lixeira com restauração

**Hoje**, há várias formas de "excluir":
- **Excluir da fila de faturar:** o lançamento some da fila. É reversível no banco, mas não há tela para desfazer.
- **Excluir na revisão:** o item volta para a fila.
- **Ignorar:** o item fica com valor zero e tem justificativa.
- **Excluir timesheet ou despesa** nas telas de lançamento: o registro é **apagado definitivamente**.

**Proposta:**
1. Nova aba **Lixeira** no Faturamento, listando os itens excluídos da fila de faturar e os itens ignorados na revisão. Para cada item:
   - data, cliente, caso, profissional, descrição, horas e valor;
   - **quem excluiu, quando e o motivo**.
2. A lixeira tem filtros por competência, cliente, caso e quem excluiu.
3. A ação **Restaurar**, individual ou em lote, devolve o item para a fila de faturar da competência original.
   - Se essa competência já foi faturada, o item vai para a competência aberta atual, e o sistema avisa.
4. O **motivo da exclusão** passa a ser pedido (opcional) no momento de excluir. Hoje ele é enviado vazio.
5. Toda exclusão e restauração fica no histórico do item.
6. Itens ficam na lixeira por tempo indeterminado *(ou 12 meses, ver pergunta)*.

**Critérios de aceite:**
- Excluir 3 lançamentos da fila faz com que eles apareçam na Lixeira com autor e data.
- Restaurar faz com que voltem para a fila e possam ser liberados normalmente.

**Perguntas ao cliente:**
- A lixeira deve cobrir também **timesheets e despesas apagados nas telas de lançamento**? Hoje esses são apagados de verdade. Incluí-los exige mudar a exclusão para "lógica". *(sugestão: sim, numa segunda etapa.)*
- Itens **ignorados** (cobrados a zero) entram na lixeira, ou só os excluídos?
- Quem pode restaurar: qualquer um com acesso ao faturamento ou só quem aprova?
- Prazo de retenção: indeterminado ou 12 meses?

### F2. Atalho para abrir o caso em outra janela

**Hoje:**
- Na Revisão e na Composição da fatura, o caso aparece só como texto ("#446 · Consultoria geral"), sem link.

**Proposta:**
1. Ao lado do nome do caso, na **Fila**, na **Revisão** e na **Composição**, um ícone **"abrir caso"** abre a ficha do caso em **nova aba**, em modo visualização.
2. O clique com o botão do meio e o Ctrl/Cmd+clique também funcionam.
3. O ícone respeita permissões: quem não pode ver contratos não vê o ícone.

**Critérios de aceite:**
- Clicar no ícone ao lado de "#446 · Consultoria geral" abre a ficha do caso em outra aba.
- A tela de faturamento continua onde estava.

**Perguntas ao cliente:**
- Abrir o **contrato** (com a lista de casos) também é útil, ou basta o caso?

### F3. Aprovação automática (projeto e outras regras)

**Hoje:**
- Todo item passa por fila → revisão → aprovação → aprovado → faturado.
- Não existe aprovação automática.
- Itens de valor fixo (projeto, mensalidade) exigem os mesmos cliques que horas.

**Proposta:**
1. Novo parâmetro **"Aprovação automática"** por **modalidade de cobrança**, com exceção por caso.
2. Quando ligado, o item é aprovado automaticamente ao ser liberado da fila e vai direto para **Aprovado**.
3. O histórico registra a aprovação como "aprovação automática – regra {modalidade}".
4. O item **pode ser devolvido** para revisão manualmente, como qualquer item aprovado.
5. Configuração inicial *(a confirmar)*:

| Modalidade | Aprovação automática |
|---|---|
| Projeto (parcela única ou parcelado) | **Sim** — pedido explícito |
| Mensalidade fixa / mensalidade de processo / carteira | Sim *(sugestão: valor não muda mês a mês)* |
| Pró-labore | Sim *(sugestão)* |
| Êxito | Não — depende de conferência do valor da ação |
| Horas | Não |
| Despesas | Não |

6. Itens com **valor alterado manualmente** ou com **teto de horas excedido** nunca são aprovados automaticamente.

**Critérios de aceite:**
- Liberar a parcela de um projeto faz com que ela apareça como Aprovada, com o registro de aprovação automática.
- Liberar horas do mesmo caso faz com que continuem passando pela revisão normal.

**Perguntas ao cliente:**
- Confirmar a tabela acima: quais modalidades, além de projeto, entram?
- Quando um caso de projeto também tem **horas lançadas** (que saem a R$ 0), essas horas também devem ser aprovadas automaticamente? *(sugestão: sim, porque não alteram o valor cobrado.)*
- Que outras regras "travam" o faturamento hoje e poderiam ser suavizadas? Por exemplo, a liberação manual da fila para itens de valor fixo. Pedimos uma lista do dia a dia do faturamento.

---

## Relatório de timesheet (PDF anotado)

### R1. Número do documento

**Hoje:**
- O PDF não tem número.

**Proposta:**
1. Número **sequencial por escritório**, atribuído na **primeira geração** do documento e exibido no cabeçalho, ao lado de Emissão e Competência. Exemplo: "Nº 000123".
2. **Regerar** o mesmo documento mantém o número.
3. A mesma numeração vale para o **relatório de despesas e a nota de débito**, que não têm nota fiscal.

**Perguntas ao cliente:**
- Sequência única para todos os documentos ou uma por tipo (timesheet, despesas, nota de débito)?
- Reinicia a cada ano?

### R2. Competência correta

**Hoje:**
- O relatório mostra a competência do **ciclo de faturamento**.
- As horas de setembro são faturadas no ciclo de outubro, então aparece "outubro/2026", embora os serviços sejam de setembro.

**Proposta:**
1. "Competência" passa a ser o **mês de execução dos serviços**. No exemplo, **setembro/2026**.
2. Abaixo, aparece o período: "Período: 01/09/2026 a 30/09/2026".
3. Emissão continua sendo a data de geração.

**Perguntas ao cliente:**
- A NFS-e e a nota de débito também devem usar essa competência (mês do serviço)? *(sugestão: sim, para tudo bater.)*
- Para mensalidades cobradas no próprio mês, a competência é o mês da mensalidade?

### R3. Todos os pagadores e percentuais no cabeçalho

**Hoje:**
- O rateio entre pagadores existe, e o sistema já emite uma NFS-e e um boleto por pagador.
- No PDF, a divisão só aparece num bloco no fim, e é omitida quando há um único pagador.

**Proposta:**
- O cabeçalho mostra **"Faturado a"** com **todos** os pagadores e seus percentuais. Exemplo: "Mendocino Participações S/A (60%) · Construtora Strobel (40%)".
- Com um único pagador, aparece o nome dele e 100%.
- O bloco de divisão de valores no rodapé continua.

**Perguntas ao cliente:**
- Gerar **um relatório por pagador** (só com o valor dele) ou um único relatório com todos? *(sugestão: um único.)*

### R4. Não imprimir linhas zeradas ou excluídas

**Hoje:**
- Todas as linhas são impressas, inclusive "0h / R$ 0,00" e lançamentos com descrição "." (exemplo: 14/09, 17/09, 25/09 e 29/09 no PDF).

**Proposta:**
- Linhas com **0h** (zeradas na revisão) e itens **excluídos** na revisão não aparecem no relatório.
- Linhas com horas mas **valor R$ 0** (casos de valor fixo) **continuam** aparecendo. Ver R5.

**Perguntas ao cliente:**
- Itens **ignorados** na revisão (horas mantidas, cobrança zero) aparecem ou não? *(sugestão: não aparecem.)*

### R5. Valor fixo no total dos relatórios de valor fechado

**Hoje:**
- Em casos de valor fixo (mensalidade, projeto, pró-labore), as linhas saem a R$ 0,00 e o total do relatório também fica **R$ 0,00**.
- O valor cobrado aparece só na NFS-e.

**Proposta** (como no exemplo da A&S Fersa – Consultoria Geral):
- As linhas continuam com descrição, tempo e **R$ 0,00**.
- O **Total** mostra as horas somadas e o **valor da regra fixa** cobrado naquela competência (mensalidade, parcela do projeto etc.).
- Uma linha de resumo identifica a origem do valor. Exemplo: "Mensalidade setembro/2026 — R$ 6.476,52".
- Se o caso tiver valor fixo **e** horas cobradas à parte (excedente), o total soma os dois e o resumo mostra os dois.

**Perguntas ao cliente:**
- Confirmar o entendimento: o valor fixo entra **só no total**, e as linhas continuam zeradas?
- Em casos de valor fixo, preferem **esconder a coluna Valor** das linhas em vez de mostrar R$ 0,00?

### R6. Memória de cálculo de impostos no rodapé

**Hoje:**
- O PDF não mostra impostos.
- O cálculo de retenções (IRRF 1,5%, PIS 0,65%, COFINS 3%, CSLL 1%, com mínimos e regras por grupo tributário) existe só na prévia da NFS-e.

**Proposta:**
- Abaixo do total, um quadro no formato do relatório do sistema Law:

```
Honorários            R$ 6.476,52
  COFINS              R$   194,30
  CSLL                R$    64,77
  IRRF                R$    97,15
  PIS                 R$    42,10
Total a Pagar         R$ 6.078,20
```

- O quadro usa **exatamente o mesmo cálculo da NFS-e**, para os valores sempre baterem.
- Quando o pagador não tem retenção, o quadro mostra só Honorários e Total a Pagar.

**Perguntas ao cliente:**
- Com rateio entre pagadores, mostrar um quadro por pagador (cada um tem a sua retenção)? *(sugestão: sim.)*
- O quadro deve sair também quando a NFS-e ainda não foi emitida (valores estimados)?

---

## Próximos passos

1. Enviar este documento ao cliente e coletar as respostas das **Perguntas ao cliente**.
2. Ordem de entrega sugerida:
   1. Ajustes rápidos e de alto impacto: **C1, C2, T2, F2, R2, R4**.
   2. Relatório: **R1, R3, R5, R6**.
   3. Funcionalidades novas: **F3, T1, F1**.

---

## Decisões do cliente (respostas de 14/10/2026)

Estas decisões **prevalecem** sobre as sugestões e perguntas acima.

**C1.** Vale para a etapa Casos do contrato e para a tela do caso. O "Voltar" do caso deve ir para o contrato por rota fixa (`/contratos/{id}/editar?step=casos`), não `router.back()`, porque o caso também é aberto em nova aba a partir do faturamento (F2), sem histórico.

**C2.**
- Ativar em lote os contratos hoje em `validacao`/`em_analise`, depois de enviar a lista para conferência.
- Contratos vindos de solicitação também nascem ativos.
- Qualquer usuário com permissão de cadastrar contrato pode deixá-lo ativo; não há permissão extra.

**T1.**
- Só os lançamentos do próprio usuário.
- Janela de 90 dias e 5 sugestões, para começar.
- "Repetir a semana anterior" fica para a próxima etapa.

**T2.** Somente lançamentos novos. Históricos não são arredondados.
- Para não travar a edição de lançamentos antigos, a validação no servidor vale para criação e para edições que alterem a duração.
- *Ponto a decidir internamente:* se a edição de um lançamento antigo, sem mudar a duração, exige ajustar para múltiplo de 5.

**F1.**
- Escopo da etapa 1: só os itens excluídos da fila (`timesheets.excluido_faturamento`).
- **Ignorados não entram** na lixeira.
- Restaurar exige uma permissão nova, por exemplo `finance.faturamento.lixeira.restore`, concedida a: sócios, Bruna Fedatto, Cines, Larissa Quadros, Jessika e a pessoa que respondeu (confirmar o nome).
- Retenção de 12 meses: após esse prazo o item some da lixeira e não pode mais ser restaurado.
- Timesheets e despesas apagados nas telas de lançamento (hoje hard delete) ficam para a etapa 2.

**F2.** Só o atalho para o caso, não para o contrato. Da tela do caso, o Voltar leva ao contrato (C1).

**F3.**
- Aprovação automática **somente para projeto** (`projeto`, incluindo parcelado). Pró-labore e mensalidades ficam de fora.
- As **horas de casos de projeto** também são autoaprovadas.
- Item com valor alterado manualmente volta a passar pela revisão.

**R1.**
- Uma sequência **por tipo de documento**, com prefixo legível: "Timesheet 1837", "Despesas 214", "Nota de débito 58".
- NFS-e mantém o número da própria nota.
- Numeração contínua, sem reinício anual.
- Regerar o documento mantém o número.

**R2.**
- Nos documentos (relatório, NFS-e e nota de débito), a competência é o mês do serviço.
- **A regra do ERP não muda:** horas e despesas do mês M continuam sendo faturadas no ciclo M+1, e as demais regras de cobrança seguem o próprio mês.
- Para horas e despesas, a competência exibida no documento é o mês do `data_lancamento`, ou seja, o ciclo − 1.
- *Interpretação a confirmar:* a resposta sobre mensalidades ("mês anterior também, mas é só para controle do cliente") sugere que a competência exibida também seja o mês anterior para mensalidades. Validar com o cliente na entrega.

**R3.** Um relatório único com todos os pagadores e percentuais no cabeçalho.

**R4.** Ocultar linhas com 0h, linhas excluídas e linhas **ignoradas**.

**R5.** Em casos de valor fixo:
- As linhas não mostram valor (sem a coluna e sem R$ 0,00), mas continuam com data, profissional, descrição e tempo.
- O relatório mostra o valor fixo do mês com a origem (ex.: "Mensalidade setembro/2026"), e o total soma o valor fixo com o excedente, se houver.

**R6.**
- Um quadro de impostos por pagador.
- O quadro aparece também na prévia, antes da emissão da NFS-e, com valores estimados, usando o mesmo cálculo da `nfse-preview-dialog`.
