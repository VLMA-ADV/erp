-- ATENCAO: script destrutivo para ambiente de homologacao.
-- Remove contratos, casos, solicitacoes, timesheets e faturamento para retestar o fluxo completo.

BEGIN;

TRUNCATE TABLE finance.billing_item_audit RESTART IDENTITY CASCADE;
TRUNCATE TABLE finance.billing_items RESTART IDENTITY CASCADE;
TRUNCATE TABLE finance.billing_batches RESTART IDENTITY CASCADE;
TRUNCATE TABLE finance.billing_notes RESTART IDENTITY CASCADE;

TRUNCATE TABLE operations.timesheets RESTART IDENTITY CASCADE;

TRUNCATE TABLE contracts.caso_anexos RESTART IDENTITY CASCADE;
TRUNCATE TABLE contracts.casos RESTART IDENTITY CASCADE;
TRUNCATE TABLE contracts.contrato_anexos RESTART IDENTITY CASCADE;
TRUNCATE TABLE contracts.contratos RESTART IDENTITY CASCADE;
TRUNCATE TABLE contracts.solicitacoes_contrato_anexos RESTART IDENTITY CASCADE;
TRUNCATE TABLE contracts.solicitacoes_contrato RESTART IDENTITY CASCADE;

COMMIT;

