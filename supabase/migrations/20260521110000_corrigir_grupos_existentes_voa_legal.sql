-- Corrige regras de retenção dos grupos preexistentes que estavam com defaults
-- errados após a migration anterior 20260521100000 (que adicionou colunas com
-- DEFAULT TRUE genérico).
--
-- Estado atual confirmado via SELECT (tenant VLMA d51463dd-...):
--   PJ Nacional       (61 contratos)  → defaults estão corretos (retém os 4 com mínimo)
--   PF Nacional       (29 contratos)  → ERRADO: precisa não reter nada
--   Estrangeiro       ( 3 contratos)  → ERRADO: precisa não reter nada
--   Sem IRRF          ( 1 contrato)   → ERRADO: precisa reter PIS+COFINS+CSLL (sem IRRF)
--   IRRF              ( 0 contratos)  → ERRADO: precisa reter só IRRF
--   Advocacia Curitiba (NFSe Nacional) (1 contrato) → mantém defaults (PJ Nacional equivalente)
--
-- Duplicatas sem acento (0 contratos usando):
--   "IRRF sem minimo" e "PJ sem minimo" → deletar
--
-- Órfão "Padrão" (0 contratos) → deletar

-- PF Nacional — sem retenções
UPDATE contracts.grupos_impostos
SET retem_irrf = FALSE, retem_pis = FALSE, retem_cofins = FALSE, retem_csll = FALSE,
    respeita_minimo = FALSE,
    descricao = COALESCE(descricao, 'Sem retenções (tomador pessoa física)')
WHERE tenant_id = 'd51463dd-a6b3-40e7-9488-854eba80a210' AND nome = 'PF Nacional';

-- Estrangeiro — sem retenções
UPDATE contracts.grupos_impostos
SET retem_irrf = FALSE, retem_pis = FALSE, retem_cofins = FALSE, retem_csll = FALSE,
    respeita_minimo = FALSE,
    descricao = COALESCE(descricao, 'Sem retenções (tomador estrangeiro)')
WHERE tenant_id = 'd51463dd-a6b3-40e7-9488-854eba80a210' AND nome = 'Estrangeiro';

-- IRRF — apenas IRRF respeitando valor mínimo
UPDATE contracts.grupos_impostos
SET retem_irrf = TRUE, retem_pis = FALSE, retem_cofins = FALSE, retem_csll = FALSE,
    respeita_minimo = TRUE,
    descricao = COALESCE(descricao, 'Retenção apenas de IRRF, respeitando valor mínimo (R$ 666,67)')
WHERE tenant_id = 'd51463dd-a6b3-40e7-9488-854eba80a210' AND nome = 'IRRF';

-- Sem IRRF — apenas COFINS, CSLL e PIS (sem IRRF)
UPDATE contracts.grupos_impostos
SET retem_irrf = FALSE, retem_pis = TRUE, retem_cofins = TRUE, retem_csll = TRUE,
    respeita_minimo = TRUE,
    descricao = COALESCE(descricao, 'Retenção apenas de COFINS, CSLL e PIS (sem IRRF)')
WHERE tenant_id = 'd51463dd-a6b3-40e7-9488-854eba80a210' AND nome = 'Sem IRRF';

-- PJ Nacional — confirmar regras corretas + descrição
UPDATE contracts.grupos_impostos
SET retem_irrf = TRUE, retem_pis = TRUE, retem_cofins = TRUE, retem_csll = TRUE,
    respeita_minimo = TRUE,
    descricao = COALESCE(descricao, 'Retenção dos 4 impostos (IRRF, PIS, COFINS, CSLL) respeitando valor mínimo de cada um')
WHERE tenant_id = 'd51463dd-a6b3-40e7-9488-854eba80a210' AND nome = 'PJ Nacional';

-- Deletar duplicatas sem acento (0 contratos usando, conforme verificado)
DELETE FROM contracts.grupos_impostos
WHERE tenant_id = 'd51463dd-a6b3-40e7-9488-854eba80a210'
  AND nome IN ('IRRF sem minimo', 'PJ sem minimo')
  AND id NOT IN (SELECT grupo_imposto_id FROM contracts.contratos WHERE grupo_imposto_id IS NOT NULL);

-- Deletar órfão Padrão se sem uso
DELETE FROM contracts.grupos_impostos
WHERE tenant_id = 'd51463dd-a6b3-40e7-9488-854eba80a210'
  AND nome = 'Padrão'
  AND id NOT IN (SELECT grupo_imposto_id FROM contracts.contratos WHERE grupo_imposto_id IS NOT NULL);
