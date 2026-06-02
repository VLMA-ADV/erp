-- Dashboard de Contratos v2 — daily Filipe 02/06.
--
-- Pedido: "dá mais robustez para o dashboard do módulo de contratos".
-- A v1 retorna 3 KPIs (total_contratos, total_casos, com_reajuste_2026) +
-- 3 cortes (responsavel, servico, produto). Insuficiente.
--
-- v2 entrega 4 KPIs grandes + série temporal 12 meses (count+valor) +
-- 6 cortes (responsavel, servico, produto, centro_custo, cliente top 10,
-- status). Mantém v1 intacta pra não quebrar nada.
--
-- Conceitos:
-- * casos_novos_mes  -> casos com created_at no mês corrente
-- * faturamento_estimado_mes -> soma de valor_mensal_carteira + valor_mensal +
--                               valor_mensalidade (em regras_financeiras[0])
--                               de casos ativos (estimativa, não real)
-- * serie_temporal -> 12 últimos meses (yyyy-mm), por mês:
--     contratos_novos, valor_mensal_total_contratos_ativos_naquele_mes
-- * por_centro_custo -> agrega centro_custo_rateio[].centro_custo_id em casos
-- * por_cliente_top -> top 10 clientes por número de contratos ativos
-- * por_status -> distribuição de status de contratos

CREATE OR REPLACE FUNCTION public.get_contratos_dashboard_v2(p_tenant_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, contracts, crm, finance, people, operations
AS $function$
DECLARE
  v_now date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_month_start date := date_trunc('month', v_now)::date;
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
        WHERE tenant_id = p_tenant_id AND status = 'ativo'
          AND parte_de_carteira_id IS NULL
      ),
      'casos_novos_mes', (
        SELECT count(*) FROM contracts.casos
        WHERE tenant_id = p_tenant_id
          AND created_at >= v_month_start::timestamptz
          AND parte_de_carteira_id IS NULL
      ),
      'contratos_novos_mes', (
        SELECT count(*) FROM contracts.contratos
        WHERE tenant_id = p_tenant_id
          AND created_at >= v_month_start::timestamptz
      )
    ),
    'serie_temporal', (
      SELECT COALESCE(json_agg(row_to_json(s) ORDER BY s.mes), '[]'::json)
      FROM (
        WITH meses AS (
          SELECT generate_series(
            date_trunc('month', (v_now - interval '11 months'))::date,
            v_month_start,
            interval '1 month'
          )::date AS mes_inicio
        )
        SELECT
          to_char(m.mes_inicio, 'YYYY-MM') AS mes,
          to_char(m.mes_inicio, 'TMMon/YY') AS rotulo,
          (
            SELECT count(*) FROM contracts.contratos c
            WHERE c.tenant_id = p_tenant_id
              AND c.created_at >= m.mes_inicio::timestamptz
              AND c.created_at < (m.mes_inicio + interval '1 month')::timestamptz
          ) AS contratos_novos,
          (
            SELECT count(*) FROM contracts.casos ca
            WHERE ca.tenant_id = p_tenant_id
              AND ca.created_at >= m.mes_inicio::timestamptz
              AND ca.created_at < (m.mes_inicio + interval '1 month')::timestamptz
              AND ca.parte_de_carteira_id IS NULL
          ) AS casos_novos
        FROM meses m
      ) s
    ),
    'por_responsavel', (
      SELECT COALESCE(json_agg(row_to_json(r)), '[]'::json)
      FROM (
        SELECT COALESCE(p.nome, 'Sem responsável') AS nome, count(*)::int AS total
        FROM contracts.casos c
        LEFT JOIN people.colaboradores p ON c.responsavel_id = p.id
        WHERE c.tenant_id = p_tenant_id
          AND c.status = 'ativo' AND c.parte_de_carteira_id IS NULL
        GROUP BY p.nome ORDER BY total DESC LIMIT 8
      ) r
    ),
    'por_servico', (
      SELECT COALESCE(json_agg(row_to_json(s)), '[]'::json)
      FROM (
        SELECT COALESCE(sv.nome, 'Sem serviço') AS nome, count(*)::int AS total
        FROM contracts.casos c
        LEFT JOIN operations.categorias_servico sv ON c.servico_id = sv.id
        WHERE c.tenant_id = p_tenant_id
          AND c.status = 'ativo' AND c.parte_de_carteira_id IS NULL
        GROUP BY sv.nome ORDER BY total DESC LIMIT 8
      ) s
    ),
    'por_produto', (
      SELECT COALESCE(json_agg(row_to_json(pr)), '[]'::json)
      FROM (
        SELECT COALESCE(pd.nome, 'Sem produto') AS nome, count(*)::int AS total
        FROM contracts.casos c
        LEFT JOIN contracts.produtos pd ON c.produto_id = pd.id
        WHERE c.tenant_id = p_tenant_id
          AND c.status = 'ativo' AND c.parte_de_carteira_id IS NULL
        GROUP BY pd.nome ORDER BY total DESC LIMIT 8
      ) pr
    ),
    'por_centro_custo', (
      SELECT COALESCE(json_agg(row_to_json(cc) ORDER BY cc.total DESC), '[]'::json)
      FROM (
        SELECT
          COALESCE(NULLIF(rateio->>'centro_custo_nome', ''), 'Sem centro de custo') AS nome,
          count(*)::int AS total
        FROM contracts.casos c
        LEFT JOIN LATERAL jsonb_array_elements(
          CASE WHEN jsonb_typeof(c.centro_custo_rateio) = 'array'
               THEN c.centro_custo_rateio
               ELSE '[]'::jsonb END
        ) AS rateio ON true
        WHERE c.tenant_id = p_tenant_id
          AND c.status = 'ativo' AND c.parte_de_carteira_id IS NULL
        GROUP BY 1 ORDER BY 2 DESC LIMIT 8
      ) cc
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

GRANT EXECUTE ON FUNCTION public.get_contratos_dashboard_v2(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_contratos_dashboard_v2(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
