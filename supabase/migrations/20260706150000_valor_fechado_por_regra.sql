-- Indicador de valor fechado no mês por regra de cobrança (pedido do cliente).
-- Regras de valoração (definidas pelo cliente):
--   projeto      -> valor_projeto (total)
--   hora         -> valor_hora (valor unitário da hora)
--   mensal/mensalidade_processo/mensalidade_carteira/salario_minimo -> valor_mensal * 12 (projetado no ano)
--   exito        -> exito_valor_fixo (ou valor_acao)
-- "Fechado no mês" = caso criado (ativado) no mês de referência.

CREATE OR REPLACE FUNCTION public.get_valor_fechado_regra(p_user_id uuid, p_ref_month date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, contracts, core AS $fn$
DECLARE v_tenant uuid; v_ini date; v_fim date;
BEGIN
  SELECT tenant_id INTO v_tenant FROM core.tenant_users WHERE user_id=p_user_id AND status='ativo' LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;
  v_ini := date_trunc('month', COALESCE(p_ref_month, (now() AT TIME ZONE 'America/Sao_Paulo')::date))::date;
  v_fim := (v_ini + interval '1 month')::date;

  RETURN jsonb_build_object(
    'mes', to_char(v_ini, 'YYYY-MM'),
    'itens', (SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.valor DESC), '[]'::jsonb) FROM (
      SELECT
        COALESCE(NULLIF(c.regra_cobranca,''), 'sem_regra') AS regra,
        count(*)::int AS qtd,
        COALESCE(round(sum(
          CASE c.regra_cobranca
            WHEN 'projeto' THEN NULLIF(c.regra_cobranca_config->>'valor_projeto','')::numeric
            WHEN 'hora' THEN NULLIF(c.regra_cobranca_config->>'valor_hora','')::numeric
            WHEN 'mensal' THEN NULLIF(c.regra_cobranca_config->>'valor_mensal','')::numeric * 12
            WHEN 'mensalidade_processo' THEN NULLIF(c.regra_cobranca_config->>'valor_mensal','')::numeric * 12
            WHEN 'mensalidade_carteira' THEN NULLIF(c.regra_cobranca_config->>'valor_mensal','')::numeric * 12
            WHEN 'salario_minimo' THEN NULLIF(c.regra_cobranca_config->>'valor_mensal','')::numeric * 12
            WHEN 'exito' THEN COALESCE(NULLIF(c.regra_cobranca_config->>'exito_valor_fixo','')::numeric, NULLIF(c.regra_cobranca_config->>'valor_acao','')::numeric)
            ELSE NULL
          END
        ), 2), 0) AS valor
      FROM contracts.casos c
      WHERE c.tenant_id = v_tenant
        AND c.created_at >= v_ini AND c.created_at < v_fim
        AND c.parte_de_carteira_id IS NULL
      GROUP BY 1
    ) x)
  );
END;
$fn$;
GRANT EXECUTE ON FUNCTION public.get_valor_fechado_regra(uuid, date) TO authenticated;
