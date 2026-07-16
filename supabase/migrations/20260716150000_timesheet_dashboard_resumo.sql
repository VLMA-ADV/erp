-- Redesign da tela de Timesheet (mock do cliente 16/07):
-- get_minhas_horas_resumo passa a devolver também perfil (nome/foto),
-- duracoes em minutos (exibicao h/min), media por dia util, top cliente
-- e a serie diaria acumulavel do mes corrente para o grafico.
CREATE OR REPLACE FUNCTION public.get_minhas_horas_resumo(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'operations', 'contracts', 'crm', 'core', 'people'
AS $function$
DECLARE
  v_tenant uuid;
  v_today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_week_start date := date_trunc('week', (now() AT TIME ZONE 'America/Sao_Paulo')::date)::date;
  v_month_start date := date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo')::date)::date;
  v_dias_uteis int;
BEGIN
  SELECT tenant_id INTO v_tenant FROM core.tenant_users WHERE user_id = p_user_id AND status='ativo' LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;

  -- Dias úteis (seg-sex) decorridos no mês, incluindo hoje.
  SELECT count(*) INTO v_dias_uteis
  FROM generate_series(v_month_start, v_today, interval '1 day') g(d)
  WHERE extract(isodow FROM g.d) < 6;
  IF v_dias_uteis IS NULL OR v_dias_uteis < 1 THEN v_dias_uteis := 1; END IF;

  RETURN (
    WITH ts AS (
      SELECT
        t.data_lancamento AS d,
        COALESCE(t.duracao_minutos / 60.0, t.horas, 0) AS h,
        COALESCE(t.duracao_minutos, round(COALESCE(t.horas, 0) * 60))::int AS mi,
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
      'perfil', (
        SELECT jsonb_build_object('nome', c.nome, 'foto_url', c.foto_url)
        FROM people.colaboradores c
        WHERE c.tenant_id = v_tenant AND c.user_id = p_user_id
        ORDER BY c.ativo DESC NULLS LAST, c.created_at DESC
        LIMIT 1
      ),
      'hoje', (SELECT COALESCE(round(sum(h)::numeric, 2), 0) FROM ts WHERE d = v_today),
      'semana', (SELECT COALESCE(round(sum(h)::numeric, 2), 0) FROM ts WHERE d >= v_week_start AND d <= v_today),
      'mes', (SELECT COALESCE(round(sum(h)::numeric, 2), 0) FROM ts WHERE d >= v_month_start),
      'mes_aprovadas', (SELECT COALESCE(round(sum(ha)::numeric, 2), 0) FROM ts WHERE d >= v_month_start),
      'hoje_min', (SELECT COALESCE(sum(mi), 0) FROM ts WHERE d = v_today),
      'semana_min', (SELECT COALESCE(sum(mi), 0) FROM ts WHERE d >= v_week_start AND d <= v_today),
      'mes_min', (SELECT COALESCE(sum(mi), 0) FROM ts WHERE d >= v_month_start),
      'mes_aprovadas_min', (SELECT COALESCE(round(sum(ha) * 60), 0) FROM ts WHERE d >= v_month_start),
      'media_dia_util_min', (SELECT COALESCE(round(sum(mi)::numeric / v_dias_uteis), 0) FROM ts WHERE d >= v_month_start),
      'top_cliente', (
        SELECT cliente_nome FROM ts WHERE d >= v_month_start AND cliente_nome IS NOT NULL
        GROUP BY cliente_nome ORDER BY sum(mi) DESC LIMIT 1
      ),
      'serie_dia', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('d', to_char(dd, 'YYYY-MM-DD'), 'min', mm) ORDER BY dd)
        FROM (SELECT d AS dd, sum(mi) AS mm FROM ts WHERE d >= v_month_start GROUP BY d) s
      ), '[]'::jsonb),
      'por_cliente', COALESCE((SELECT jsonb_agg(jsonb_build_object('label', COALESCE(cliente_nome,'Sem cliente'), 'horas', round(h::numeric,2), 'minutos', mi) ORDER BY mi DESC)
                               FROM (SELECT cliente_nome, sum(h) h, sum(mi) mi FROM ts WHERE d >= v_month_start GROUP BY 1) s), '[]'::jsonb),
      'por_caso', COALESCE((SELECT jsonb_agg(jsonb_build_object('label', COALESCE(caso_label,'Sem caso'), 'horas', round(h::numeric,2), 'minutos', mi) ORDER BY mi DESC)
                            FROM (SELECT caso_label, sum(h) h, sum(mi) mi FROM ts WHERE d >= v_month_start GROUP BY 1) s), '[]'::jsonb)
    )
  );
END;
$function$;
