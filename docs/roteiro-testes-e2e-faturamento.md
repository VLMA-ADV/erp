# Roteiro de testes E2E — Fluxo de Faturamento (v1.25.0)

**Para o cliente validar:** cada caso abaixo vira um teste automatizado (Playwright) que rodará
sozinho antes de cada publicação. Leia os passos e o "Deve acontecer" e nos diga se alguma
regra está errada ou faltando — é isso que o robô vai verificar para sempre.

**Pré-requisitos (uma vez):**
- Usuários de teste com senha fixa (guardada em variável de ambiente, nunca no código):
  Felipe Fidencio (Contencioso), Rafael Küster (Societário), Rodrigo Batti (Tributário),
  Tiago Ecker (coord. Societário), Leonardo (coord. Tributário), Douglas, Renata, Filipe (financeiro).
- Casos de referência configurados:
  | Caso | Centro de custo | Revisor | Aprovador | Regra de cobrança |
  |---|---|---|---|---|
  | 7 Holding → Arbitragem RD | Contencioso | Douglas (nomeado) | Renata | Mensalidade de processo |
  | Zendur → Acordo de Quotistas | Societário | Tiago (nomeado) | Renata | Projeto parcelado |
  | Coritiba → Caso AB | Proporcional | Automático por centro de custo | Renata | Hora |
- Todo teste começa clicando **"Reiniciar mês (teste)"** (Itens a faturar) e termina limpo.

---

## E2E-01 · Hora aparece na etapa 1 assim que é lançada
**Quem:** Rafael (Societário)
**Passos:** entrar → Timesheet → Novo lançamento → Coritiba / Caso AB / 1h / descrição → Salvar → abrir Itens a faturar.
**Deve acontecer:** a hora aparece imediatamente na aba **Horas** (caso é hora pura), sem precisar de nenhum botão.

## E2E-02 · Hora herda a regra do caso (aba certa + valor primeiro)
**Quem:** Felipe Fidencio (Contencioso)
**Passos:** lançar 1h na 7 Holding / Arbitragem RD → abrir Itens a faturar.
**Deve acontecer:** a hora aparece na aba **Mensalidade de processo** (não em Horas). Dentro do caso, o **valor da regra (R$ 3.342) vem primeiro** e a hora aparece embaixo, como validação. A aba Horas fica só com contratos por hora pura.

## E2E-03 · Envio para revisão com papéis corretos (revisor nomeado)
**Quem:** Filipe (financeiro) envia; Douglas e Renata conferem.
**Passos:** em Itens a faturar, selecionar a 7 Holding → Enviar → abrir Revisão de fatura → expandir o caso Arbitragem RD.
**Deve acontecer:** três linhas de etapa:
- **Envio = Felipe Fidencio** (autor real, nunca outra pessoa);
- **Revisão = Douglas** (revisor nomeado no caso — revisa tudo do caso, mesmo de outros centros de custo);
- **Aprovação = Renata**, com a **faixa roxa visível desde já** ("aguardando"), antes de qualquer ação dela.

## E2E-04 · Revisão automática por centro de custo (multi-CC)
**Quem:** Rafael (Societário) e Rodrigo (Tributário) lançam; Tiago e Leonardo revisam.
**Passos:** cada um lança 1h no Coritiba / Caso AB → Filipe envia → entrar como Tiago e abrir a Revisão → entrar como Leonardo e abrir a Revisão.
**Deve acontecer:** **Tiago vê apenas a hora do Rafael** (seu centro de custo) e **Leonardo vê apenas a do Rodrigo**. Nenhum vê a hora do outro. Em cada linha, Revisão = coordenador do CC do autor.

## E2E-05 · Trava de aprovação no multi-CC
**Quem:** Renata (aprovadora), com o cenário do E2E-04 pela metade.
**Passos:** Tiago revisa (OK) a hora do Rafael; Leonardo ainda NÃO revisou a do Rodrigo → Renata tenta aprovar a hora do Rafael.
**Deve acontecer:** o sistema **bloqueia** com aviso ("ainda há horas deste caso aguardando revisão dos coordenadores"). Depois que Leonardo revisa, Renata **consegue aprovar as duas** — e ela enxerga as horas de todos os centros de custo.

## E2E-06 · Linha riscada e OK sem recarregar
**Quem:** Tiago (revisor)
**Passos:** na Revisão, dar OK em 3 itens seguidos.
**Deve acontecer:** cada linha de Envio fica **riscada** após o OK, o item muda de etapa **sem a tela recarregar** (sem "Carregando...", sem perder a posição), e dá para seguir para o próximo item direto.

## E2E-07 · Tela recolhida por padrão + Expandir tudo + horas em h/min
**Quem:** qualquer revisor.
**Passos:** abrir a Revisão de fatura → observar → clicar "Expandir tudo" → conferir uma hora de 1,33.
**Deve acontecer:** a tela abre com **todos os grupos fechados**; "Expandir tudo" abre todos (e vira "Recolher tudo"); as horas aparecem como **"1h 20min"**, nunca 1,33.

## E2E-08 · Excluir hora não revisada some da revisão na hora
**Quem:** Rafael lança e exclui; Tiago confere.
**Passos:** lançar 1h → Filipe envia para revisão → **antes de qualquer revisão**, Rafael exclui o lançamento no Timesheet → Tiago abre/atualiza a Revisão.
**Deve acontecer:** a hora **não está mais** na Revisão (e o "Envio" nunca mostra outra pessoa no lugar do autor).

## E2E-09 · Hora já revisada não pode ser excluída
**Quem:** Rafael tenta excluir depois do Tiago revisar.
**Passos:** mesmo fluxo do E2E-08, mas Tiago dá OK antes → Rafael tenta excluir no Timesheet.
**Deve acontecer:** o sistema **impede** com aviso ("já foi revisado no faturamento — peça ao revisor para reabrir").

## E2E-10 · Gerar faturamento do mês (só regras, contagem certa)
**Quem:** Filipe (financeiro)
**Passos:** Reiniciar mês (teste) → clicar Gerar faturamento do mês → confirmar.
**Deve acontecer:** cria os itens de **todas as regras ativas do mês** (mensalidades, parcela de projeto do mês, êxito do mês) com a **contagem correta** na mensagem (nunca "0 itens" com itens criados). **Nenhuma hora é arrastada** — horas entram conforme lançadas. Parcela vencida em mês anterior **não** aparece.

## E2E-11 · Gerar de novo = aviso amigável (não erro)
**Quem:** Filipe
**Passos:** clicar Gerar faturamento do mês pela segunda vez, sem nada novo.
**Deve acontecer:** mensagem **"Todas as regras do período já estavam geradas — nenhum item novo."** — sem tela de erro.

## E2E-12 · Aprovador restrito a Renata/Douglas
**Quem:** Filipe (edição de caso)
**Passos:** abrir um caso → configuração de Timesheet → campo Aprovadores → abrir o seletor.
**Deve acontecer:** a lista mostra **somente Renata e Douglas** (sócios diretores). Não dá para escolher outra pessoa.

## E2E-13 · Reiniciar mês (teste) com proteções
**Quem:** Filipe (financeiro) e um usuário sem permissão.
**Passos:** Filipe clica Reiniciar mês (teste) e confirma; depois um usuário comum tenta o mesmo.
**Deve acontecer:** para o Filipe, itens/lotes do mês são apagados e as horas voltam para o Timesheet como "em lançamento" (contratos e lançamentos intactos). Para o usuário comum, **recusa**. Se houver **nota fiscal emitida** no período, recusa também.

---

**Fora deste roteiro (combinar depois):** mensalidade de carteira no Gerar do mês; emissão de NF (depende dos códigos de imposto do contador); atualização "ao vivo" entre usuários (hoje precisa recarregar para ver ação de outra pessoa).
