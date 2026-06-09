# PRD — Módulo Contas a Pagar (e Fluxo de Caixa)

> Status: **spec FECHADA (2026-06-10)** — cliente respondeu as 10 perguntas (áudio) e Lucas autorizou os defaults. Mock de UI analisado. Pronto para construir.
> Decisões finais na seção 11; decisões de UI na seção 12.

## 1. Problema
A gestão de despesas do escritório (aluguel, folha, fornecedores, impostos, assinaturas) vive hoje em uma planilha ("Contas a pagar / Fluxo de caixa") — fora do ERP. Isso gera controle manual, ausência de status de pagamento, nenhuma previsão de reajuste e nenhuma ligação com o faturamento já registrado no sistema. O ERP atual só registra **despesas de processo** (reembolsáveis, vinculadas a caso/cliente), não as despesas operacionais do escritório. Além disso, o escritório frequentemente paga despesas das spin-offs do grupo (Ravena, Verve) e precisa marcá-las como **reembolsáveis** — sai do caixa agora, volta como entrada depois.

## 2. Objetivo de negócio
Trazer o controle de contas a pagar para dentro do ERP: lançar despesas previsíveis com recorrência e reajuste projetado, acompanhar status/baixa (com reagendamento), separar por empresa pagadora, sinalizar reembolsáveis, e consolidar um fluxo de caixa simples (saldo inicial manual + saídas + entradas do faturamento).

## 3. Público-alvo
- Financeiro/Administrativo (lançamento e baixa)
- Sócios e Diretoria (visão consolidada, fluxo de caixa, aprovação) — enxergam tudo.

## 4. Métricas de sucesso
- M-001: 100% das despesas recorrentes da planilha migradas e gerando parcelas mensais no sistema.
- M-002: Toda conta a pagar com status, conta contábil + categoria (grupo macro) e empresa pagadora preenchidos.
- M-003: Fluxo de caixa do mês coerente com o saldo informado manualmente + saídas baixadas + entradas do faturamento.
- M-004: 0 regressões nos módulos existentes após deploy das migrations (manual via Management API).

## 5. Escopo (in / out)
### In scope
- Tela de **Contas a Pagar**: cadastro/listagem/edição com filtros por período, categoria (grupo macro), conta contábil, status, fornecedor e **empresa pagadora**.
- **Plano de contas em 2 camadas** (Q2 — NÃO são 3):
  1. **Conta contábil** — o código numérico.
  2. **Categoria / grupo macro** — ex.: *Despesas Administrativas*, *Imóvel*, *Impostos Diretos*, *Impostos Indiretos*. Serve para relatório ("quanto gastei com impostos diretos no período?").
  - Listas simples, pré-carregadas a partir da planilha.
- **Campos do lançamento** (Q1): tipo (fixo/variável), conta contábil, categoria, fornecedor, empresa pagadora, valor, vencimento, recorrência, reajuste programado, número da nota fiscal, boleto (anexo), forma de pagamento, conta bancária de saída, observações, **reembolsável (flag)**.
- **Empresa pagadora + reembolsável** (Q3): cada despesa vinculada a uma empresa do grupo (Escritório / Ravena / Verve) conforme a **fonte pagadora** (CNPJ). Flag `reembolsável` indica que a saída retornará como entrada — mesma lógica das despesas de cartório reembolsáveis dos processos.
- **Recorrência** (Q6): no lançamento — "é recorrente? Sim/Não" + "quantas parcelas? (N)". Gera 1 conta a pagar por mês automaticamente; cada parcela editável individualmente. `N = 0` ⇒ recorrência sem prazo definido (gera mês a mês até cancelar) `[CONFIRMAR]`.
- **Reajuste programado** (Q7): mesma lógica dos contratos de honorários — data do reajuste + índice (IPCA) aplicados como **projeção/estimativa** ("cálculo de padaria", não valor oficial). Ex.: "em janeiro reajusta pelo IPCA".
- **Baixa de pagamento** (Q8): status **Pendente / Paga / Atrasada / Cancelada / Remanejada** + data/valor pago + conta bancária. Botão **Reagendar** (empurra vencimento/previsão para nova data, com histórico) — usado tanto em saídas quanto nas entradas atrasadas (honorários).
- **Fluxo de caixa** (Q9): **saldo inicial lançado manualmente** por conta bancária (sem conciliação bancária — fora do escopo). Conta principal = **Itaú**. A partir do saldo informado, o sistema debita as saídas baixadas e contabiliza as entradas (faturamento/honorários). Entradas atrasadas podem ser reagendadas.
- **Acesso** (Q10): restrito a financeiro/administrativo e sócios. Sócios enxergam tudo.

### Out of scope (fase 1)
- Conciliação bancária automática (OFX/Open Finance) — explicitamente fora ("muito complexo").
- Emissão/registro de boletos.
- Cálculo oficial/automático de índice (IPCA/IGP-M) — usa-se projeção estimada (Q7).
- **Campo criticidade (Indispensável/Dispensável)** — DESCARTADO (Q4).
- **Coluna de percentual** — DESCARTADA (Q5).
- 3ª camada do plano de contas — reduzido a 2 camadas (Q2).
- Integração com ERP contábil externo.

## 6. Requisitos funcionais
- RF-001: Cadastrar despesa com os campos: tipo (fixo/variável), conta contábil, categoria, fornecedor, empresa pagadora, valor, vencimento, recorrência, reajuste programado, número da nota, boleto, forma de pagamento, conta bancária de saída, observações e flag reembolsável. **Obrigatórios**: valor, vencimento, conta contábil, categoria, empresa pagadora `[CONFIRMAR obrigatoriedade]`. (Q1)
- RF-002: Conta contábil (código numérico) e categoria/grupo macro são listas cadastráveis (não texto livre), pré-carregadas da planilha. (Q2)
- RF-003: Cada despesa é vinculada a uma empresa pagadora (CNPJ/fonte pagadora: Escritório, Ravena, Verve). (Q3)
- RF-004: Flag **reembolsável** na despesa: quando marcada, a saída gera uma **previsão de entrada futura** (reembolso) no fluxo de caixa. (Q3)
- RF-005: Recorrência: ao marcar "recorrente" e informar N parcelas, o sistema gera uma conta a pagar por mês; cada parcela é editável individualmente (valores que mudam em meses específicos). `N=0` = sem prazo. (Q6)
- RF-006: Reajuste programado: na data do reajuste, aplica o novo valor projetado (índice IPCA estimado, editável) nas parcelas seguintes. (Q7)
- RF-007: Cada conta a pagar tem status (Pendente/Paga/Atrasada/Cancelada/Remanejada) e registro de baixa (data, valor pago, conta bancária). (Q8)
- RF-008: Botão **Reagendar** move o vencimento/previsão de uma conta (saída ou entrada) para nova data, preservando histórico. (Q8)
- RF-009: Permitir anexar boleto/NF/comprovante ao lançamento. (Q8)
- RF-010: Fluxo de caixa compõe saldo corrente a partir do **saldo inicial informado manualmente** por conta bancária (Itaú), das saídas baixadas e das entradas. (Q9)
- RF-011: As entradas do fluxo de caixa vêm do **faturamento/recebimentos existentes** no ERP (honorários), e podem ser reagendadas quando atrasam. (Q9)
- RF-012: Acesso restrito a financeiro/administrativo e sócios; sócios com visão total. (Q10)
- RF-013: Fluxo de aprovação **opcional** antes do pagamento, restrito aos perfis acima. (Q10)

## 7. Requisitos não funcionais
- RNF-001: Migrações de banco backward-compatible, em schema de domínio próprio (não `public`), aplicadas manualmente via Supabase Management API (canal vigente do projeto).
- RNF-002: Toda RPC/edge function valida JWT e as permissões vigentes do usuário.
- RNF-003: Telas responsivas (desktop e mobile) sem quebra de layout.
- RNF-004: Listagens com filtro por período/categoria/status respondem em p95 ≤ 500ms para o volume de um tenant.
- RNF-005: Geração de parcelas recorrentes idempotente (re-rodar não duplica).
- RNF-006: `npm run -s type-check` sem erros.

## 8. Modelo de dados (proposta consolidada — sujeito a `[CONFIRMAR]`)
- `core.categorias_despesa` (id, nome, ativo) — grupo macro (Despesa Administrativa, Imóvel, Impostos Diretos/Indiretos…).
- `core.contas_contabeis` (id, codigo numérico, categoria_id, nome, ativo).
- `core.fornecedores` (reuso do PRD anterior).
- `core.empresas_grupo` (id, nome, cnpj) — Escritório, Ravena, Verve (fonte pagadora).
- `finance.contas_pagar` (id, tenant_id, empresa_id, fornecedor_id, conta_contabil_id, categoria_id, tipo, descricao, valor, vencimento, status, recorrencia_id?, reembolsavel bool, numero_nota, boleto_url, forma_pagamento, conta_bancaria_saida_id, observacoes, baixa_data, baixa_valor, baixa_conta_id, reagendado_de?).
- `finance.recorrencias` (id, regra mensal, valor_base, inicio, num_parcelas (0=sem prazo), reajuste_data?, reajuste_indice ('IPCA'), reajuste_percentual_estimado?).
- `finance.contas_bancarias` (id, banco ('Itaú'), saldo_abertura (manual), saldo_abertura_data).
- Entradas do fluxo: **view/consulta** sobre o faturamento existente + previsões de reembolso (despesas reembolsáveis). Não é tabela nova de receita.

## 9. Critérios de aceite
- CA-001: Cadastrar/editar/listar conta a pagar com todos os campos confirmados (RF-001).
- CA-002: Conta contábil e categoria selecionáveis a partir das listas pré-carregadas (RF-002).
- CA-003: Despesa vinculada a empresa pagadora; relatório por categoria/empresa (RF-003).
- CA-004: Despesa reembolsável gera previsão de entrada no fluxo (RF-004).
- CA-005: Recorrente gera parcelas do período, editáveis individualmente, sem duplicar ao re-rodar (RF-005, RNF-005).
- CA-006: Reajuste programado aplica o valor projetado na data correta (RF-006).
- CA-007: Baixa registra status/data/valor/banco; **Reagendar** move a data com histórico; anexo disponível (RF-007, RF-008, RF-009).
- CA-008: Fluxo de caixa com saldo inicial manual (Itaú) + saídas baixadas + entradas do faturamento, coerente (RF-010, RF-011).
- CA-009: Acesso restrito conforme perfil; aprovação (se ligada) bloqueia pagamento não aprovado (RF-012, RF-013).
- CA-010: `npm run -s type-check` sem erros e smoke test do módulo concluído (RNF-006).

## 10. Perguntas — RESPONDIDAS (2026-06-09)
1. **Campos do lançamento** → tipo (fixo/var), conta contábil, categoria, fornecedor, empresa pagadora, valor, vencimento, recorrência, reajuste programado, nº nota, boleto, forma de pagamento, conta de saída, observações, reembolsável. Sem criticidade.
2. **Plano de contas** → **2 camadas**: conta contábil (número) + categoria/grupo macro (para relatórios). Guiar pela planilha.
3. **Empresas do grupo** → sim, separar por empresa pagadora (CNPJ): Escritório/Ravena/Verve. + flag **reembolsável** (saída que volta como entrada).
4. **Criticidade** → **não é necessário**.
5. **Coluna de percentual** → **não é necessário** por enquanto.
6. **Recorrência** → automática: "recorrente? sim → quantas parcelas (N)". Parcela editável. N=0 = sem prazo `[CONFIRMAR]`.
7. **Reajuste** → mesma lógica dos honorários: data + índice IPCA **projetado/estimado** ("cálculo de padaria"), editável.
8. **Baixa** → status Paga/Atrasada/Cancelada/Remanejada; despesa geralmente paga no dia; **botão Reagendar** (importante) p/ saídas e entradas atrasadas.
9. **Fluxo de caixa** → **saldo inicial manual** por conta (sem conciliação). Conta = Itaú. Debita saídas, soma entradas do faturamento.
10. **Acesso/aprovação** → restrito a financeiro/administrativo e sócios; sócios enxergam tudo; aprovação opcional.

## 11. Decisões finais (2026-06-10 — Lucas autorizou seguir com defaults)
- Recorrência `N=0` ⇒ **sem prazo / contínua até cancelar** (gera mês a mês).
- Reajuste IPCA ⇒ **percentual digitado pelo usuário no lançamento** (estimativa "de padaria"); sem fonte automática de índice.
- Reembolsável ⇒ ao marcar a flag, **cria automaticamente uma previsão de ENTRADA** (reembolso) no fluxo, vinculada à despesa.
- Obrigatórios no RF-001: **valor, vencimento, conta contábil, categoria, empresa pagadora**. Demais opcionais.

## 12. Decisões de UI (mock analisado 2026-06-10)
- Visão única **Contas a Pagar + Receber** ("Rotina diária") com KPIs do dia, filtros (Pendentes/Vencidas/Pagos), pré-visualização no lançamento.
- **SEM conciliação** na fase 1: remover tab "Conciliação", KPI "Conciliado do dia" e filtro "Conciliadas" do mock → substituir por **Pagos/Baixados**. (Cliente: "não quero conciliação bancária ainda".)
- **"Centro de custo" (rótulo do mock) = a categoria/grupo macro** do Q2. Mantém-se o label "Centro de custo" na UI, mas é a 2ª camada (não há 3ª).
- **Saldo inicial manual** por conta (Itaú): adicionar ponto de entrada do saldo de abertura (não existe no mock) — base do saldo corrente do fluxo de caixa.
- Form = **PRD completo**: além do que o mock mostra (fornecedor, recorrente, conta contábil, centro de custo, valor, vencimento, anexo, observações), incluir: empresa pagadora, reembolsável, tipo (fixo/variável), nº de parcelas (quando recorrente), reajuste programado (data + % IPCA), forma de pagamento, conta bancária de saída, número da nota. Campos extras podem ficar em seção "mais opções".
- **Reagendar**: ícone de calendário por linha (já no mock) → move vencimento/previsão com histórico.
