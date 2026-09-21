-- =====================================================================
-- Itens liberados com janela de data absurda voltam para a competencia certa
--
-- Ao ligar as abas por competencia (20260922100000), apareceram 136 itens
-- pendentes com periodo_inicio em 2000-09-01, 2023-01-01 e 2026-01-01 (e
-- periodo_fim em 2030 ou 2026-12-31): foram liberados em 01 e 02/09 pela
-- etapa 1 com o seletor de datas aberto demais. Todos sao horas e despesas
-- trabalhadas entre 31/07 e 01/09/2026 — competencia setembro. Sem este
-- acerto, virariam abas "Faturamento de setembro de 2000".
--
-- So horas e despesas (nenhuma regra financeira no lote, entao a chave de
-- idempotencia do gerador nao e afetada). Nao mexe em valores.
-- =====================================================================
UPDATE finance.billing_items bi
   SET periodo_inicio = '2026-09-01', periodo_fim = '2026-09-30', updated_at = now()
 WHERE bi.status IN ('em_revisao', 'em_aprovacao', 'aprovado')
   AND bi.origem_tipo IN ('timesheet', 'despesa')
   AND date_trunc('month', bi.periodo_inicio) < '2026-09-01'
   AND bi.data_referencia >= '2026-07-01';
