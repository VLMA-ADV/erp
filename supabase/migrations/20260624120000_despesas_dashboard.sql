-- Despesas: dashboard (resumo).
-- KPIs do dia/semana/mês (relativos a hoje) + total/por cliente/por caso
-- filtrados por mês e cliente. Exclui despesas canceladas.

CREATE OR REPLACE FUNCTION public.get_despesas_dashboard(
  p_user_id uuid, p_ref_month date DEFAULT NULL, p_cliente_id uuid DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_tenant_id uuid;
  v_today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_week_start date := date_trunc('week', (now() AT TIME ZONE 'America/Sao_Paulo'))::date;
  v_month_start date := date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo'))::date;
  v_ref_start date := date_trunc('month', COALESCE(p_ref_month, v_today))::date;
  v_ref_end date := (date_trunc('month', COALESCE(p_ref_month, v_today)) + interval '1 month')::date;
BEGIN
  SELECT tenant_id INTO v_tenant_id FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id AND tu.status = 'ativo' LIMIT 1;
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;

  RETURN jsonb_build_object(
    -- KPIs relativos a hoje (não filtrados)
    'hoje', (SELECT jsonb_build_object('count', count(*), 'valor', COALESCE(sum(valor),0))
      FROM operations.despesas WHERE tenant_id=v_tenant_id AND status<>'cancelado' AND data_lancamento = v_today),
    'semana', (SELECT jsonb_build_object('count', count(*), 'valor', COALESCE(sum(valor),0))
      FROM operations.despesas WHERE tenant_id=v_tenant_id AND status<>'cancelado' AND data_lancamento >= v_week_start),
    'mes', (SELECT jsonb_build_object('count', count(*), 'valor', COALESCE(sum(valor),0))
      FROM operations.despesas WHERE tenant_id=v_tenant_id AND status<>'cancelado' AND data_lancamento >= v_month_start),
    -- Total do período filtrado (mês + cliente)
    'filtro_total', (SELECT jsonb_build_object('count', count(*), 'valor', COALESCE(sum(valor),0))
      FROM operations.despesas
      WHERE tenant_id=v_tenant_id AND status<>'cancelado'
        AND data_lancamento >= v_ref_start AND data_lancamento < v_ref_end
        AND (p_cliente_id IS NULL OR cliente_id = p_cliente_id)),
    'por_cliente', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('label', COALESCE(cli.nome,'Sem cliente'), 'count', s.n, 'valor', s.v) ORDER BY s.v DESC)
      FROM (
        SELECT cliente_id, count(*) n, COALESCE(sum(valor),0) v
        FROM operations.despesas
        WHERE tenant_id=v_tenant_id AND status<>'cancelado'
          AND data_lancamento >= v_ref_start AND data_lancamento < v_ref_end
          AND (p_cliente_id IS NULL OR cliente_id = p_cliente_id)
        GROUP BY cliente_id ORDER BY v DESC LIMIT 10
      ) s LEFT JOIN crm.clientes cli ON cli.id = s.cliente_id
    ), '[]'::jsonb),
    'por_caso', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('label', COALESCE(cs.numero::text || ' — ' || cs.nome,'Sem caso'), 'count', s.n, 'valor', s.v) ORDER BY s.v DESC)
      FROM (
        SELECT caso_id, count(*) n, COALESCE(sum(valor),0) v
        FROM operations.despesas
        WHERE tenant_id=v_tenant_id AND status<>'cancelado'
          AND data_lancamento >= v_ref_start AND data_lancamento < v_ref_end
          AND (p_cliente_id IS NULL OR cliente_id = p_cliente_id)
        GROUP BY caso_id ORDER BY v DESC LIMIT 10
      ) s LEFT JOIN contracts.casos cs ON cs.id = s.caso_id
    ), '[]'::jsonb),
    'clientes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', cli.id, 'nome', cli.nome) ORDER BY cli.nome)
      FROM (SELECT DISTINCT cliente_id FROM operations.despesas WHERE tenant_id=v_tenant_id AND cliente_id IS NOT NULL) d
      JOIN crm.clientes cli ON cli.id = d.cliente_id
    ), '[]'::jsonb)
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_despesas_dashboard(uuid, date, uuid) TO authenticated, service_role;
