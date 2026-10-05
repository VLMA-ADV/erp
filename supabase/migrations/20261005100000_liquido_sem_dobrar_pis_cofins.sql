-- Erro meu de 02/10: o líquido saía menor que o da nota (NF 2099: 13.530,00 em
-- vez de 14.077,50). No pedido à prefeitura, `valor_csll` JÁ É a retenção
-- unificada PIS+COFINS+CSLL (4,65%) - emit-nfse manda vRetUnificada nesse
-- campo - e `valor_pis`/`valor_cofins` vão junto só como detalhamento. Somar
-- os três descontava PIS e COFINS duas vezes. Conferido contra o XML
-- autorizado: vTotalRet = vRetIRRF + vRetCSLL = 922,50; vLiq = 14.077,50.
CREATE OR REPLACE FUNCTION finance.valor_liquido_da_nota(p_metadata jsonb)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  WITH r AS (SELECT COALESCE(p_metadata->'focus_request', '{}'::jsonb) AS q)
  SELECT GREATEST(0, round(
    COALESCE(NULLIF(p_metadata->>'valor_total','')::numeric, 0)
    - COALESCE(NULLIF(q->>'valor_irrf','')::numeric, 0)
    -- retenção unificada (PIS+COFINS+CSLL); se um dia vier sem ela, cai na soma das partes
    - COALESCE(NULLIF(q->>'valor_csll','')::numeric,
               COALESCE(NULLIF(q->>'valor_pis','')::numeric, 0) + COALESCE(NULLIF(q->>'valor_cofins','')::numeric, 0))
    - COALESCE(NULLIF(q->>'valor_inss','')::numeric, 0)
    - CASE WHEN COALESCE(NULLIF(q->>'tipo_retencao_iss','')::int, 1) IN (2, 3)
           THEN COALESCE(NULLIF(q->>'valor_iss','')::numeric, NULLIF(p_metadata->>'valor_iss','')::numeric, 0)
           ELSE 0 END
  , 2)) FROM r;
$$;
