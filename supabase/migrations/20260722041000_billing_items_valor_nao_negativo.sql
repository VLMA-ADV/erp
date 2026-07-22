-- Fase de segurança — impedir valores/horas negativos no faturamento.
--
-- Bug: o fluxo de revisão/aprovação aceitava valor (e horas) negativos, pois
-- update_revisao_fatura_item não valida sinal. Um CHECK na tabela cobre TODOS
-- os caminhos de escrita (RPC, edge, futuros), não só a RPC atual.
--
-- Regra de negócio de TETO PARA CIMA (aprovar acima do informado) fica
-- pendente da definição do cliente (#6) — aqui tratamos apenas o sinal.
--
-- NULLs continuam válidos (etapas ainda não preenchidas). Verificado: não há
-- linhas negativas hoje, então os constraints validam sem quebrar dados.

ALTER TABLE finance.billing_items
  ADD CONSTRAINT billing_items_valor_informado_nao_negativo CHECK (valor_informado IS NULL OR valor_informado >= 0),
  ADD CONSTRAINT billing_items_valor_revisado_nao_negativo  CHECK (valor_revisado  IS NULL OR valor_revisado  >= 0),
  ADD CONSTRAINT billing_items_valor_aprovado_nao_negativo  CHECK (valor_aprovado  IS NULL OR valor_aprovado  >= 0),
  ADD CONSTRAINT billing_items_horas_informadas_nao_negativa CHECK (horas_informadas IS NULL OR horas_informadas >= 0),
  ADD CONSTRAINT billing_items_horas_revisadas_nao_negativa  CHECK (horas_revisadas  IS NULL OR horas_revisadas  >= 0),
  ADD CONSTRAINT billing_items_horas_aprovadas_nao_negativa  CHECK (horas_aprovadas  IS NULL OR horas_aprovadas  >= 0);
