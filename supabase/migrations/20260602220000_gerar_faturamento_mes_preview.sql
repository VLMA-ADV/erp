-- Preview (dry-run) da geração de faturamento mensal.
--
-- Daily Filipe 02/06: "a gente pode ter um botão de gerar faturamento do mês.
-- Qual que é o cálculo? Ele vai verificar todos os contratos ativos que tem
-- regra elegível para aquele mês". A engine que faz a geração (RPC
-- public.start_faturamento_flow + edge start-faturamento) já existe e é
-- idempotente. Esta RPC é o "raio-X" prévio: lê quantos casos são elegíveis
-- e quanto vai ser gerado, SEM criar nada. O frontend usa isso pra montar
-- um modal de confirmação com números antes de disparar a geração real.
--
-- Regras consideradas elegíveis mensalmente: mensal, mensalidade_processo,
-- mensalidade_carteira, salario_minimo. Filhos de carteira são excluídos
-- (já cobertos pela matriz).
--
-- Idempotência: a contagem `ja_existentes` mostra quantos billing_items com
-- origem_tipo='regra_financeira' já existem para os mesmos casos no período
-- alvo (status <> cancelado). A RPC de geração real (start_faturamento_flow)
-- pula esses casos no INSERT via NOT EXISTS.

CREATE OR REPLACE FUNCTION public.gerar_faturamento_mes_preview(
  p_user_id uuid,
  p_competencia text -- 'YYYY-MM'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, contracts, crm, finance, people, operations
AS $$
DECLARE
  v_tenant_id uuid;
  v_periodo_inicio date;
  v_periodo_fim date;
  v_resultado jsonb;
BEGIN
  SELECT tu.tenant_id INTO v_tenant_id
    FROM core.tenant_users tu
   WHERE tu.user_id = p_user_id AND tu.status = 'ativo'
   LIMIT 1;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não pertence a nenhum tenant';
  END IF;

  IF p_competencia IS NULL OR p_competencia !~ '^\d{4}-\d{2}$' THEN
    RAISE EXCEPTION 'Competência inválida (esperado YYYY-MM): %', p_competencia;
  END IF;

  v_periodo_inicio := (p_competencia || '-01')::date;
  v_periodo_fim := (v_periodo_inicio + interval '1 month' - interval '1 day')::date;

  WITH casos_eleg AS (
    SELECT
      c.id AS caso_id,
      c.contrato_id,
      c.regra_cobranca,
      c.regra_cobranca_config,
      c.regras_financeiras
    FROM contracts.casos c
    JOIN contracts.contratos ct ON ct.id = c.contrato_id
    WHERE ct.tenant_id = v_tenant_id
      AND ct.status = 'ativo'
      AND c.status = 'ativo'
      AND c.regra_cobranca IN ('mensal', 'mensalidade_processo', 'mensalidade_carteira', 'salario_minimo')
      AND c.parte_de_carteira_id IS NULL
  ),
  por_regra AS (
    SELECT
      ce.regra_cobranca,
      count(*)::int AS casos,
      sum(
        CASE ce.regra_cobranca
          WHEN 'mensal' THEN
            COALESCE(NULLIF(ce.regra_cobranca_config->>'valor_mensal', '')::numeric, 0)
          WHEN 'mensalidade_processo' THEN
            COALESCE(NULLIF(ce.regra_cobranca_config->>'valor_mensal', '')::numeric, 0)
          WHEN 'mensalidade_carteira' THEN
            COALESCE(NULLIF(ce.regra_cobranca_config->>'valor_mensal_carteira', '')::numeric, 0)
          WHEN 'salario_minimo' THEN
            COALESCE(NULLIF(ce.regra_cobranca_config->>'quantidade_sm', '')::numeric, 0) *
            COALESCE((SELECT valor FROM config.salario_minimo sm
                      WHERE sm.tenant_id = v_tenant_id
                        AND sm.vigencia_desde <= v_periodo_fim
                      ORDER BY sm.vigencia_desde DESC LIMIT 1), 0)
          ELSE 0
        END
      )::numeric(14,2) AS valor_total
    FROM casos_eleg ce
    GROUP BY ce.regra_cobranca
  ),
  ja_existentes AS (
    SELECT count(DISTINCT bi.caso_id)::int AS total
    FROM finance.billing_items bi
    JOIN casos_eleg ce ON ce.caso_id = bi.caso_id
    WHERE bi.tenant_id = v_tenant_id
      AND bi.status <> 'cancelado'
      AND bi.origem_tipo = 'regra_financeira'
      AND COALESCE(bi.data_referencia, bi.periodo_inicio) >= v_periodo_inicio
      AND COALESCE(bi.data_referencia, bi.periodo_inicio) <= v_periodo_fim
  )
  SELECT jsonb_build_object(
    'competencia', p_competencia,
    'periodo_inicio', v_periodo_inicio,
    'periodo_fim', v_periodo_fim,
    'contratos_elegiveis', (SELECT count(DISTINCT contrato_id) FROM casos_eleg),
    'casos_elegiveis', (SELECT count(*) FROM casos_eleg),
    'ja_existentes_no_periodo', COALESCE((SELECT total FROM ja_existentes), 0),
    'estimado_itens_novos', GREATEST(
      0,
      (SELECT count(*) FROM casos_eleg) - COALESCE((SELECT total FROM ja_existentes), 0)
    ),
    'valor_estimado_total', COALESCE((SELECT sum(valor_total) FROM por_regra), 0),
    'por_regra', COALESCE(
      (SELECT jsonb_object_agg(
        regra_cobranca,
        jsonb_build_object('casos', casos, 'valor_total', valor_total)
      ) FROM por_regra),
      '{}'::jsonb
    )
  ) INTO v_resultado;

  RETURN v_resultado;
END;
$$;

GRANT EXECUTE ON FUNCTION public.gerar_faturamento_mes_preview(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.gerar_faturamento_mes_preview(uuid, text) TO service_role;

NOTIFY pgrst, 'reload schema';
