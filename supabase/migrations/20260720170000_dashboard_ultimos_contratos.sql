CREATE OR REPLACE FUNCTION public.get_contratos_dashboard_v2(p_tenant_id uuid, p_ref_month date DEFAULT NULL::date)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'contracts', 'crm', 'finance', 'people', 'operations'
AS $function$
DECLARE
  v_now date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_month_start date := date_trunc('month', COALESCE(p_ref_month, v_now))::date;
  v_month_end date := (date_trunc('month', COALESCE(p_ref_month, v_now)) + interval '1 month')::date;
  v_result json;
BEGIN
  SELECT json_build_object(
    'kpis', json_build_object(
      'contratos_ativos', (
        SELECT count(*) FROM contracts.contratos
        WHERE tenant_id = p_tenant_id AND status = 'ativo'
      ),
      'casos_ativos', (
        SELECT count(*) FROM contracts.casos
        WHERE tenant_id = p_tenant_id AND status = 'ativo' AND parte_de_carteira_id IS NULL
      ),
      'casos_novos_mes', (
        SELECT count(*) FROM contracts.casos
        WHERE tenant_id = p_tenant_id
          AND created_at >= v_month_start::timestamptz
          AND created_at < v_month_end::timestamptz
          AND parte_de_carteira_id IS NULL
      ),
      'contratos_novos_mes', (
        SELECT count(*) FROM contracts.contratos
        WHERE tenant_id = p_tenant_id
          AND created_at >= v_month_start::timestamptz
          AND created_at < v_month_end::timestamptz
      )
    ),
    'serie_temporal', (
      SELECT COALESCE(json_agg(row_to_json(s) ORDER BY s.mes), '[]'::json)
      FROM (
        WITH meses AS (
          SELECT generate_series(
            date_trunc('month', (v_now - interval '11 months'))::date,
            date_trunc('month', v_now)::date,
            interval '1 month'
          )::date AS mes_inicio
        )
        SELECT
          to_char(m.mes_inicio, 'YYYY-MM') AS mes,
          to_char(m.mes_inicio, 'TMMon/YY') AS rotulo,
          (SELECT count(*) FROM contracts.contratos c
            WHERE c.tenant_id = p_tenant_id
              AND c.created_at >= m.mes_inicio::timestamptz
              AND c.created_at < (m.mes_inicio + interval '1 month')::timestamptz) AS contratos_novos,
          (SELECT count(*) FROM contracts.casos ca
            WHERE ca.tenant_id = p_tenant_id
              AND ca.created_at >= m.mes_inicio::timestamptz
              AND ca.created_at < (m.mes_inicio + interval '1 month')::timestamptz
              AND ca.parte_de_carteira_id IS NULL) AS casos_novos
        FROM meses m
      ) s
    ),
    'por_responsavel', (
      SELECT COALESCE(json_agg(row_to_json(r)), '[]'::json)
      FROM (
        SELECT COALESCE(p.nome, 'Sem responsável') AS nome, count(*)::int AS total
        FROM contracts.casos c
        LEFT JOIN people.colaboradores p ON c.responsavel_id = p.id
        WHERE c.tenant_id = p_tenant_id AND c.status = 'ativo' AND c.parte_de_carteira_id IS NULL
        GROUP BY p.nome ORDER BY total DESC LIMIT 8
      ) r
    ),
    'por_servico', (
      SELECT COALESCE(json_agg(row_to_json(s)), '[]'::json)
      FROM (
        SELECT COALESCE(sv.nome, 'Sem serviço') AS nome, count(*)::int AS total
        FROM contracts.casos c
        LEFT JOIN operations.categorias_servico sv ON c.servico_id = sv.id
        WHERE c.tenant_id = p_tenant_id AND c.status = 'ativo' AND c.parte_de_carteira_id IS NULL
        GROUP BY sv.nome ORDER BY total DESC LIMIT 8
      ) s
    ),
    'por_produto', (
      SELECT COALESCE(json_agg(row_to_json(pr)), '[]'::json)
      FROM (
        SELECT COALESCE(pd.nome, 'Sem produto') AS nome, count(*)::int AS total
        FROM contracts.casos c
        LEFT JOIN contracts.produtos pd ON c.produto_id = pd.id
        WHERE c.tenant_id = p_tenant_id AND c.status = 'ativo' AND c.parte_de_carteira_id IS NULL
        GROUP BY pd.nome ORDER BY total DESC LIMIT 8
      ) pr
    ),
    'por_centro_custo', (
      SELECT COALESCE(json_agg(row_to_json(cc) ORDER BY cc.total DESC), '[]'::json)
      FROM (
        SELECT
          COALESCE(ar.nome, NULLIF(rateio->>'centro_custo_nome', ''), 'Sem centro de custo') AS nome,
          count(*)::int AS total
        FROM contracts.casos c
        LEFT JOIN LATERAL jsonb_array_elements(
          CASE WHEN jsonb_typeof(c.centro_custo_rateio) = 'array' THEN c.centro_custo_rateio ELSE '[]'::jsonb END
        ) AS rateio ON true
        LEFT JOIN people.areas ar ON ar.id = NULLIF(rateio->>'centro_custo_id', '')::uuid
        WHERE c.tenant_id = p_tenant_id AND c.status = 'ativo' AND c.parte_de_carteira_id IS NULL
        GROUP BY 1 ORDER BY 2 DESC LIMIT 8
      ) cc
    ),
    'por_regra_cobranca_mes', (
      SELECT COALESCE(json_agg(row_to_json(rc) ORDER BY rc.total DESC), '[]'::json)
      FROM (
        SELECT COALESCE(NULLIF(c.regra_cobranca, ''), 'Sem regra') AS nome, count(*)::int AS total
        FROM contracts.casos c
        WHERE c.tenant_id = p_tenant_id AND c.parte_de_carteira_id IS NULL
          AND c.created_at >= v_month_start::timestamptz
          AND c.created_at < v_month_end::timestamptz
        GROUP BY 1 ORDER BY 2 DESC
      ) rc
    ),
    'por_cliente_top', (
      SELECT COALESCE(json_agg(row_to_json(cl)), '[]'::json)
      FROM (
        SELECT cli.nome AS nome, count(*)::int AS total
        FROM contracts.contratos ct
        JOIN crm.clientes cli ON cli.id = ct.cliente_id
        WHERE ct.tenant_id = p_tenant_id AND ct.status = 'ativo'
        GROUP BY cli.nome ORDER BY total DESC LIMIT 10
      ) cl
    ),
    'por_status', (
      SELECT COALESCE(json_agg(row_to_json(st)), '[]'::json)
      FROM (
        SELECT COALESCE(ct.status, 'sem status') AS nome, count(*)::int AS total
        FROM contracts.contratos ct
        WHERE ct.tenant_id = p_tenant_id
        GROUP BY ct.status ORDER BY total DESC
      ) st
    ),
    -- Últimos contratos cadastrados (pedido Filipe 20/07): lista dos recentes
    -- pra visão geral, com cliente e data de cadastro.
    'ultimos_contratos', (
      SELECT COALESCE(json_agg(row_to_json(uc)), '[]'::json)
      FROM (
        SELECT ct.id, ct.numero_sequencial, ct.numero, ct.nome_contrato,
               cli.nome AS cliente_nome, ct.status,
               to_char(ct.created_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') AS criado_em
        FROM contracts.contratos ct
        LEFT JOIN crm.clientes cli ON cli.id = ct.cliente_id
        WHERE ct.tenant_id = p_tenant_id
        ORDER BY ct.created_at DESC
        LIMIT 8
      ) uc
    )
  ) INTO v_result;

  RETURN v_result;
END;
$function$
;
