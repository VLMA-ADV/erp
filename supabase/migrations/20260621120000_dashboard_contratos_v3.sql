-- Dashboard de Contratos v3:
-- * corrige por_centro_custo (resolve nome pelo id em people.areas — antes só
--   lia o nome embutido no JSON, deixando casos importados como "Sem centro").
-- * adiciona por_regra_cobranca_mes (casos criados no mês por regra de cobrança).
-- * aceita mês de referência (p_ref_month) para o filtro de mês.
-- * nova get_contratos_dashboard_drill: lista os contratos/casos de um grupo
--   (para o mini popup ao clicar).

DROP FUNCTION IF EXISTS public.get_contratos_dashboard_v2(uuid);

CREATE OR REPLACE FUNCTION public.get_contratos_dashboard_v2(p_tenant_id uuid, p_ref_month date DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, contracts, crm, finance, people, operations
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
    )
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_contratos_dashboard_v2(uuid, date) TO authenticated, service_role;

-- ── Drill: lista os contratos/casos de um grupo (mini popup) ────────────────
CREATE OR REPLACE FUNCTION public.get_contratos_dashboard_drill(
  p_tenant_id uuid, p_dim text, p_valor text, p_ref_month date DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, contracts, crm, finance, people, operations
AS $function$
DECLARE
  v_now date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_ms date := date_trunc('month', COALESCE(p_ref_month, v_now))::date;
  v_me date := (date_trunc('month', COALESCE(p_ref_month, v_now)) + interval '1 month')::date;
  v_result json;
BEGIN
  IF p_dim = 'por_cliente_top' THEN
    SELECT COALESCE(json_agg(json_build_object('numero', ct.numero, 'nome', ct.nome_contrato, 'cliente', cli.nome, 'caso', NULL) ORDER BY ct.numero), '[]'::json)
    INTO v_result
    FROM contracts.contratos ct JOIN crm.clientes cli ON cli.id = ct.cliente_id
    WHERE ct.tenant_id = p_tenant_id AND ct.status = 'ativo' AND cli.nome = p_valor;
  ELSIF p_dim = 'por_status' THEN
    SELECT COALESCE(json_agg(json_build_object('numero', ct.numero, 'nome', ct.nome_contrato, 'cliente', cli.nome, 'caso', NULL) ORDER BY ct.numero), '[]'::json)
    INTO v_result
    FROM contracts.contratos ct JOIN crm.clientes cli ON cli.id = ct.cliente_id
    WHERE ct.tenant_id = p_tenant_id AND COALESCE(ct.status, 'sem status') = p_valor;
  ELSE
    -- dimensões baseadas em casos
    SELECT COALESCE(json_agg(json_build_object('numero', ct.numero, 'nome', ct.nome_contrato, 'cliente', cli.nome, 'caso', c.nome) ORDER BY ct.numero), '[]'::json)
    INTO v_result
    FROM contracts.casos c
    JOIN contracts.contratos ct ON ct.id = c.contrato_id
    JOIN crm.clientes cli ON cli.id = ct.cliente_id
    LEFT JOIN people.colaboradores p ON p.id = c.responsavel_id
    LEFT JOIN operations.categorias_servico sv ON sv.id = c.servico_id
    LEFT JOIN contracts.produtos pd ON pd.id = c.produto_id
    WHERE c.tenant_id = p_tenant_id AND c.parte_de_carteira_id IS NULL
      AND (
        (p_dim = 'por_responsavel' AND c.status='ativo' AND COALESCE(p.nome,'Sem responsável') = p_valor) OR
        (p_dim = 'por_servico'     AND c.status='ativo' AND COALESCE(sv.nome,'Sem serviço') = p_valor) OR
        (p_dim = 'por_produto'     AND c.status='ativo' AND COALESCE(pd.nome,'Sem produto') = p_valor) OR
        (p_dim = 'por_centro_custo' AND c.status='ativo' AND EXISTS (
          SELECT 1 FROM jsonb_array_elements(
            CASE WHEN jsonb_typeof(c.centro_custo_rateio)='array' THEN c.centro_custo_rateio ELSE '[]'::jsonb END
          ) rr
          LEFT JOIN people.areas ar2 ON ar2.id = NULLIF(rr->>'centro_custo_id','')::uuid
          WHERE COALESCE(ar2.nome, NULLIF(rr->>'centro_custo_nome',''), 'Sem centro de custo') = p_valor
        )) OR
        (p_dim = 'por_regra_cobranca_mes'
          AND COALESCE(NULLIF(c.regra_cobranca,''),'Sem regra') = p_valor
          AND c.created_at >= v_ms::timestamptz AND c.created_at < v_me::timestamptz)
      )
    LIMIT 200;
  END IF;

  RETURN v_result;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_contratos_dashboard_drill(uuid, text, text, date) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
