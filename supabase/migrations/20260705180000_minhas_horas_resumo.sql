-- Timesheet · resumo individual do próprio usuário (hoje/semana/mês + por cliente/caso).
-- Disponível para TODO colaborador (não só gestor). Escopo: só os próprios lançamentos.

CREATE OR REPLACE FUNCTION public.get_minhas_horas_resumo(p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, operations, contracts, crm, core AS $fn$
DECLARE
  v_tenant uuid;
  v_today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_week_start date := date_trunc('week', (now() AT TIME ZONE 'America/Sao_Paulo')::date)::date;
  v_month_start date := date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo')::date)::date;
BEGIN
  SELECT tenant_id INTO v_tenant FROM core.tenant_users WHERE user_id = p_user_id AND status='ativo' LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;

  RETURN (
    WITH ts AS (
      SELECT
        t.data_lancamento AS d,
        COALESCE(t.duracao_minutos / 60.0, t.horas, 0) AS h,
        COALESCE(t.horas_aprovadas, 0) AS ha,
        cli.nome AS cliente_nome,
        (cs.numero::text || ' — ' || cs.nome) AS caso_label
      FROM operations.timesheets t
      LEFT JOIN contracts.casos cs ON cs.id = t.caso_id
      LEFT JOIN contracts.contratos ct ON ct.id = t.contrato_id
      LEFT JOIN crm.clientes cli ON cli.id = ct.cliente_id
      WHERE t.tenant_id = v_tenant AND t.created_by = p_user_id
    )
    SELECT jsonb_build_object(
      'hoje', (SELECT COALESCE(round(sum(h)::numeric, 2), 0) FROM ts WHERE d = v_today),
      'semana', (SELECT COALESCE(round(sum(h)::numeric, 2), 0) FROM ts WHERE d >= v_week_start AND d <= v_today),
      'mes', (SELECT COALESCE(round(sum(h)::numeric, 2), 0) FROM ts WHERE d >= v_month_start),
      'mes_aprovadas', (SELECT COALESCE(round(sum(ha)::numeric, 2), 0) FROM ts WHERE d >= v_month_start),
      'por_cliente', COALESCE((SELECT jsonb_agg(jsonb_build_object('label', COALESCE(cliente_nome,'Sem cliente'), 'horas', round(h::numeric,2)) ORDER BY h DESC)
                               FROM (SELECT cliente_nome, sum(h) h FROM ts WHERE d >= v_month_start GROUP BY 1) s), '[]'::jsonb),
      'por_caso', COALESCE((SELECT jsonb_agg(jsonb_build_object('label', COALESCE(caso_label,'Sem caso'), 'horas', round(h::numeric,2)) ORDER BY h DESC)
                            FROM (SELECT caso_label, sum(h) h FROM ts WHERE d >= v_month_start GROUP BY 1) s), '[]'::jsonb)
    )
  );
END;
$fn$;
GRANT EXECUTE ON FUNCTION public.get_minhas_horas_resumo(uuid) TO authenticated;
