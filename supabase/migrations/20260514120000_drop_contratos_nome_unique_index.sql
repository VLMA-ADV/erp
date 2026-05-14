-- Drop legacy uniqueness on contracts.contratos.nome_contrato.
--
-- Motivação: numero_sequencial (RF-064) já garante identidade única por
-- tenant; o índice idx_contratos_tenant_nome_unique era resquício pré-RF-064
-- e está bloqueando cadastros novos (Filipe, daily 14/05) sempre que o nome
-- gerado/digitado coincide com algum existente.
--
-- Idempotente: DROP INDEX IF EXISTS não falha quando o índice não existe
-- (ambientes que nunca o criaram via migration tracked, ex.: dev legado).

DROP INDEX IF EXISTS contracts.idx_contratos_tenant_nome_unique;
DROP INDEX IF EXISTS public.idx_contratos_tenant_nome_unique;
