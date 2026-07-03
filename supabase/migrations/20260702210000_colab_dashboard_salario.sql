-- Colaboradores dashboard: adiciona quebra por faixa salarial (por_salario).
CREATE OR REPLACE FUNCTION public.get_colaboradores_dashboard(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_tenant_id uuid;
BEGIN
  SELECT tenant_id INTO v_tenant_id
  FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id AND tu.status = 'ativo'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não associado a tenant';
  END IF;

  RETURN jsonb_build_object(
    'total', (SELECT count(*) FROM people.colaboradores WHERE tenant_id = v_tenant_id AND ativo),
    'por_categoria', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('label', categoria::text, 'count', n) ORDER BY n DESC)
      FROM (SELECT categoria, count(*) n FROM people.colaboradores WHERE tenant_id = v_tenant_id AND ativo GROUP BY categoria) s
    ), '[]'::jsonb),
    'por_cargo', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('label', COALESCE(ca.nome, 'Sem cargo'), 'count', s.n) ORDER BY s.n DESC)
      FROM (SELECT cargo_id, count(*) n FROM people.colaboradores WHERE tenant_id = v_tenant_id AND ativo GROUP BY cargo_id) s
      LEFT JOIN people.cargos ca ON ca.id = s.cargo_id
    ), '[]'::jsonb),
    'por_centro_custo', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('label', COALESCE(ar.nome, 'Sem centro de custo'), 'count', s.n) ORDER BY s.n DESC)
      FROM (SELECT area_id, count(*) n FROM people.colaboradores WHERE tenant_id = v_tenant_id AND ativo GROUP BY area_id) s
      LEFT JOIN people.areas ar ON ar.id = s.area_id
    ), '[]'::jsonb),
    'por_adicional', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('label', COALESCE(adicional::text, 'Nenhuma'), 'count', n) ORDER BY n DESC)
      FROM (SELECT adicional, count(*) n FROM people.colaboradores WHERE tenant_id = v_tenant_id AND ativo GROUP BY adicional) s
    ), '[]'::jsonb),
    'por_salario', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('label', faixa, 'count', n) ORDER BY ord)
      FROM (
        SELECT
          CASE
            WHEN salario IS NULL OR salario = 0 THEN 'Não informado'
            WHEN salario < 3000 THEN 'Até R$ 3.000'
            WHEN salario < 6000 THEN 'R$ 3.000 – 6.000'
            WHEN salario < 10000 THEN 'R$ 6.000 – 10.000'
            WHEN salario < 15000 THEN 'R$ 10.000 – 15.000'
            ELSE 'Acima de R$ 15.000'
          END AS faixa,
          CASE
            WHEN salario IS NULL OR salario = 0 THEN 6
            WHEN salario < 3000 THEN 1
            WHEN salario < 6000 THEN 2
            WHEN salario < 10000 THEN 3
            WHEN salario < 15000 THEN 4
            ELSE 5
          END AS ord,
          count(*) n
        FROM people.colaboradores WHERE tenant_id = v_tenant_id AND ativo
        GROUP BY faixa, ord
      ) s
    ), '[]'::jsonb)
  );
END;
$function$;
