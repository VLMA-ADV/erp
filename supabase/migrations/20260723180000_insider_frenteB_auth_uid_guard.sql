-- FASE 2 (insider) — Frente B: guard auth.uid() nas 2 RPCs que o front chama direto
-- e que recebem p_user_id (get_user_permissions, get_minhas_horas_resumo).
--
-- Diferente da Frente A (essas NÃO podem ser revogadas de authenticated — o front
-- precisa delas), o fix é coerção suave no topo do corpo:
--     p_user_id := COALESCE(auth.uid(), p_user_id);
-- Numa chamada autenticada direta, ignora o p_user_id recebido e usa a identidade
-- do token (um atacante que passa o id de outro só enxerga os próprios dados, sem
-- erro). Edge/service_role têm auth.uid() nulo → mantêm o parâmetro (já validado).
-- Chamadores internos passam o id do usuário agindo (= auth.uid()), então é no-op.
--
-- Corpo idêntico ao de produção, só com a linha da coerção adicionada.

CREATE OR REPLACE FUNCTION public.get_user_permissions(p_user_id uuid)
 RETURNS TABLE(permission_key character varying)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'core', 'people'
AS $function$
DECLARE
  v_tenant_id UUID;
  v_categoria people.colaborador_categoria;
BEGIN
  -- Segurança (insider): em chamada autenticada, usa sempre a identidade do token.
  p_user_id := COALESCE(auth.uid(), p_user_id);

  -- Buscar tenant do usuário
  SELECT tenant_id INTO v_tenant_id
  FROM core.tenant_users
  WHERE user_id = p_user_id
    AND status = 'ativo'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RETURN;
  END IF;

  -- Buscar categoria do colaborador
  SELECT c.categoria INTO v_categoria
  FROM people.colaboradores c
  WHERE c.user_id = p_user_id
    AND c.tenant_id = v_tenant_id
  LIMIT 1;

  -- Se categoria for 'socio' ou 'administrativo', retornar todas as permissões
  IF v_categoria IN ('socio', 'administrativo') THEN
    RETURN QUERY
    SELECT DISTINCT p.chave::VARCHAR
    FROM core.permissions p
    WHERE p.tenant_id = v_tenant_id
    ORDER BY p.chave;
    RETURN;
  END IF;

  -- Retornar permissões de roles E permissões diretas (UNION DISTINCT)
  RETURN QUERY
  SELECT DISTINCT p.chave::VARCHAR
  FROM (
    -- Permissões de roles
    SELECT DISTINCT p.chave
    FROM core.user_roles ur
    JOIN core.role_permissions rp ON ur.role_id = rp.role_id
    JOIN core.permissions p ON rp.permission_id = p.id
    WHERE ur.user_id = p_user_id
      AND ur.tenant_id = v_tenant_id
      AND p.tenant_id = v_tenant_id

    UNION

    -- Permissões diretas do usuário
    SELECT DISTINCT p.chave
    FROM core.user_permissions up
    JOIN core.permissions p ON up.permission_id = p.id
    WHERE up.user_id = p_user_id
      AND up.tenant_id = v_tenant_id
      AND p.tenant_id = v_tenant_id
  ) p
  ORDER BY p.chave;
END;
$function$;

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
  -- Segurança (insider): em chamada autenticada, usa sempre a identidade do token.
  p_user_id := COALESCE(auth.uid(), p_user_id);

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
