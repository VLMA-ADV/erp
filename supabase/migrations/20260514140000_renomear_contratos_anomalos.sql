-- Daily 2026-05-14 (Filipe 17:04): "numeração sequencial de contratos antigos".
--
-- Contratos antigos foram criados antes do padrão `Contrato {numero_sequencial}`
-- e ficaram com nomes hex-UUID (ex.: "Contrato a1da3a6b9dd5") ou retry-loop
-- residuals da edge antiga (ex.: "Contrato (2)", "Contrato (3)"...). Filipe
-- quer uniformizar tudo no padrão atual.
--
-- Pré-requisito: índice idx_contratos_tenant_nome_unique já foi removido
-- pela migration 20260514120000 (PR #104), portanto este UPDATE não pode
-- conflitar com unique constraint.
--
-- Idempotente: WHERE filtra apenas os fora do padrão; rodar de novo é no-op.

UPDATE contracts.contratos
SET nome_contrato = 'Contrato ' || numero_sequencial,
    updated_at = now()
WHERE numero_sequencial IS NOT NULL
  AND nome_contrato !~ '^Contrato \d+$'
  AND nome_contrato !~ '^Contrato \d+ \(\d+\)$';
