-- Cadastro completo dos 7 grupos de impostos da VLMA conforme regras do
-- contador Guilherme Cavanha Verve (mensagem WhatsApp 21/05/2026 16:24 e 18:12)
--
-- Alíquotas oficiais:
--   COFINS – 3,00%  (mín. cálculo R$ 215,34, mín. retenção R$ 6,46)
--   CSLL   – 1,00%  (mín. cálculo R$ 215,34, mín. retenção R$ 2,15)
--   PIS    – 0,65%  (mín. cálculo R$ 215,34, mín. retenção R$ 1,40)
--   IRRF   – 1,50%  (mín. cálculo R$ 666,67, mín. retenção R$ 10,00)
--   ISS    – 3,50%  (Curitiba advocacia, item lista 1714)
--
-- Sem INSS — confirmado que VLMA não retém INSS na fonte.
--
-- Decisão arquitetural (call Filipe 20/05/2026 17:31): grupo_imposto fica no
-- contrato (não no cliente), porque pode mudar por contrato. Cliente padrão
-- = PJ Nacional, mas cada contrato pode ter outro grupo.

-- Adiciona novas colunas em contracts.grupos_impostos para suportar a lógica
-- completa de retenção por grupo. (As colunas básicas já vieram da migration
-- 20260520100000.)
ALTER TABLE contracts.grupos_impostos
  ADD COLUMN IF NOT EXISTS retem_irrf            BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS retem_pis             BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS retem_cofins          BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS retem_csll            BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS respeita_minimo       BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS aliquota_irrf         NUMERIC(5,2) DEFAULT 1.50,
  ADD COLUMN IF NOT EXISTS aliquota_pis          NUMERIC(5,2) DEFAULT 0.65,
  ADD COLUMN IF NOT EXISTS aliquota_cofins       NUMERIC(5,2) DEFAULT 3.00,
  ADD COLUMN IF NOT EXISTS aliquota_csll         NUMERIC(5,2) DEFAULT 1.00,
  ADD COLUMN IF NOT EXISTS min_calc_irrf         NUMERIC(10,2) DEFAULT 666.67,
  ADD COLUMN IF NOT EXISTS min_calc_pis_cofins_csll NUMERIC(10,2) DEFAULT 215.34,
  ADD COLUMN IF NOT EXISTS min_ret_irrf          NUMERIC(10,2) DEFAULT 10.00,
  ADD COLUMN IF NOT EXISTS min_ret_pis           NUMERIC(10,2) DEFAULT 1.40,
  ADD COLUMN IF NOT EXISTS min_ret_cofins        NUMERIC(10,2) DEFAULT 6.46,
  ADD COLUMN IF NOT EXISTS min_ret_csll          NUMERIC(10,2) DEFAULT 2.15;

-- Popular os 7 grupos para o tenant VLMA
DO $$
DECLARE v_tenant uuid;
BEGIN
  SELECT id INTO v_tenant FROM core.tenants WHERE nome ILIKE '%voa%legal%' OR nome ILIKE '%vlma%' LIMIT 1;
  IF v_tenant IS NULL THEN
    RAISE NOTICE 'Tenant VLMA não encontrado. Pulando seed dos grupos de impostos.';
    RETURN;
  END IF;

  -- 1) PJ Nacional — retém os 4 impostos respeitando valor mínimo (caso comum)
  INSERT INTO contracts.grupos_impostos (
    tenant_id, nome, descricao,
    retem_irrf, retem_pis, retem_cofins, retem_csll, respeita_minimo,
    codigo_tributacao_nacional_iss, codigo_nbs, aliquota_iss,
    tributacao_iss, tipo_retencao_iss, situacao_tributaria_pis_cofins,
    pct_trib_federais, pct_trib_estaduais, pct_trib_municipais
  ) VALUES (
    v_tenant, 'PJ Nacional',
    'Retenção dos 4 impostos (IRRF, PIS, COFINS, CSLL) respeitando valor mínimo de cada um',
    TRUE, TRUE, TRUE, TRUE, TRUE,
    '130501', '121012200', 3.5,
    1, 1, '00', 10.38, 0, 2.5
  ) ON CONFLICT DO NOTHING;

  -- 2) PF Nacional — sem retenções
  INSERT INTO contracts.grupos_impostos (
    tenant_id, nome, descricao,
    retem_irrf, retem_pis, retem_cofins, retem_csll, respeita_minimo,
    codigo_tributacao_nacional_iss, codigo_nbs, aliquota_iss,
    tributacao_iss, tipo_retencao_iss, situacao_tributaria_pis_cofins,
    pct_trib_federais, pct_trib_estaduais, pct_trib_municipais
  ) VALUES (
    v_tenant, 'PF Nacional', 'Sem retenções (tomador pessoa física)',
    FALSE, FALSE, FALSE, FALSE, FALSE,
    '130501', '121012200', 3.5,
    1, 1, '00', 10.38, 0, 2.5
  ) ON CONFLICT DO NOTHING;

  -- 3) Estrangeiro — sem retenções
  INSERT INTO contracts.grupos_impostos (
    tenant_id, nome, descricao,
    retem_irrf, retem_pis, retem_cofins, retem_csll, respeita_minimo,
    codigo_tributacao_nacional_iss, codigo_nbs, aliquota_iss,
    tributacao_iss, tipo_retencao_iss, situacao_tributaria_pis_cofins,
    pct_trib_federais, pct_trib_estaduais, pct_trib_municipais
  ) VALUES (
    v_tenant, 'Estrangeiro', 'Sem retenções (tomador estrangeiro)',
    FALSE, FALSE, FALSE, FALSE, FALSE,
    '130501', '121012200', 3.5,
    1, 1, '00', 10.38, 0, 2.5
  ) ON CONFLICT DO NOTHING;

  -- 4) IRRF — apenas IRRF respeitando valor mínimo
  INSERT INTO contracts.grupos_impostos (
    tenant_id, nome, descricao,
    retem_irrf, retem_pis, retem_cofins, retem_csll, respeita_minimo,
    codigo_tributacao_nacional_iss, codigo_nbs, aliquota_iss,
    tributacao_iss, tipo_retencao_iss, situacao_tributaria_pis_cofins,
    pct_trib_federais, pct_trib_estaduais, pct_trib_municipais
  ) VALUES (
    v_tenant, 'IRRF', 'Retenção apenas de IRRF, respeitando valor mínimo (R$ 666,67)',
    TRUE, FALSE, FALSE, FALSE, TRUE,
    '130501', '121012200', 3.5,
    1, 1, '00', 10.38, 0, 2.5
  ) ON CONFLICT DO NOTHING;

  -- 5) PJ sem mínimo — retém os 4 impostos independente de valor
  INSERT INTO contracts.grupos_impostos (
    tenant_id, nome, descricao,
    retem_irrf, retem_pis, retem_cofins, retem_csll, respeita_minimo,
    codigo_tributacao_nacional_iss, codigo_nbs, aliquota_iss,
    tributacao_iss, tipo_retencao_iss, situacao_tributaria_pis_cofins,
    pct_trib_federais, pct_trib_estaduais, pct_trib_municipais
  ) VALUES (
    v_tenant, 'PJ sem mínimo',
    'Retenção dos 4 impostos independente do valor bruto faturado',
    TRUE, TRUE, TRUE, TRUE, FALSE,
    '130501', '121012200', 3.5,
    1, 1, '00', 10.38, 0, 2.5
  ) ON CONFLICT DO NOTHING;

  -- 6) IRRF sem mínimo — apenas IRRF independente de valor
  INSERT INTO contracts.grupos_impostos (
    tenant_id, nome, descricao,
    retem_irrf, retem_pis, retem_cofins, retem_csll, respeita_minimo,
    codigo_tributacao_nacional_iss, codigo_nbs, aliquota_iss,
    tributacao_iss, tipo_retencao_iss, situacao_tributaria_pis_cofins,
    pct_trib_federais, pct_trib_estaduais, pct_trib_municipais
  ) VALUES (
    v_tenant, 'IRRF sem mínimo',
    'Retenção apenas de IRRF, independente do valor bruto faturado',
    TRUE, FALSE, FALSE, FALSE, FALSE,
    '130501', '121012200', 3.5,
    1, 1, '00', 10.38, 0, 2.5
  ) ON CONFLICT DO NOTHING;

  -- 7) Sem IRRF — apenas COFINS, CSLL e PIS (sem IRRF)
  INSERT INTO contracts.grupos_impostos (
    tenant_id, nome, descricao,
    retem_irrf, retem_pis, retem_cofins, retem_csll, respeita_minimo,
    codigo_tributacao_nacional_iss, codigo_nbs, aliquota_iss,
    tributacao_iss, tipo_retencao_iss, situacao_tributaria_pis_cofins,
    pct_trib_federais, pct_trib_estaduais, pct_trib_municipais
  ) VALUES (
    v_tenant, 'Sem IRRF',
    'Retenção apenas de COFINS, CSLL e PIS (sem IRRF)',
    FALSE, TRUE, TRUE, TRUE, TRUE,
    '130501', '121012200', 3.5,
    1, 1, '00', 10.38, 0, 2.5
  ) ON CONFLICT DO NOTHING;
END $$;

-- Remove o grupo seed antigo placeholder "Advocacia Curitiba (NFSe Nacional)"
-- (criado na migration 20260520100000_grupos_impostos_nfse_nacional_fields.sql)
-- se ainda existir e não estiver sendo usado por nenhum contrato.
DELETE FROM contracts.grupos_impostos
WHERE nome = 'Advocacia Curitiba (NFSe Nacional)'
  AND id NOT IN (SELECT grupo_imposto_id FROM contracts.contratos WHERE grupo_imposto_id IS NOT NULL);
