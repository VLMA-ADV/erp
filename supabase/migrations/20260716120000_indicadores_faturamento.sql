-- Aba "Indicadores" da Revisão de fatura (pedido do cliente 15/07):
-- horas lançadas (etapa 1) x revisadas (etapa 2) x aprovadas (etapa 3),
-- ignoradas com motivo, cut de horas e tabela por cliente com projeção.
-- Escopo igual ao da revisão: diretor/Financeiro vê tudo; gestor vê sua área.

CREATE OR REPLACE FUNCTION public.get_indicadores_faturamento(p_data_inicio date DEFAULT NULL, p_data_fim date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_tenant uuid;
  v_inicio date;
  v_fim date;
  v_can_view_all boolean := false;
  v_area uuid;
  v_area_nome text;
  v_resumo jsonb;
  v_clientes jsonb;
BEGIN
  SELECT tenant_id INTO v_tenant
  FROM core.tenant_users tu
  WHERE tu.user_id = v_user AND tu.status = 'ativo'
  LIMIT 1;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Usuário não associado a tenant';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.get_user_permissions(v_user) p
    WHERE p.permission_key IN (
      'finance.faturamento.read', 'finance.faturamento.review', 'finance.faturamento.approve',
      'finance.faturamento.manage', 'finance.faturamento.*', 'finance.*', '*'
    )
  ) THEN
    RAISE EXCEPTION 'Sem permissão para visualizar indicadores';
  END IF;

  v_inicio := COALESCE(p_data_inicio, date_trunc('month', CURRENT_DATE)::date);
  v_fim := COALESCE(p_data_fim, (date_trunc('month', CURRENT_DATE) + interval '1 month - 1 day')::date);

  SELECT col.area_id, a.nome INTO v_area, v_area_nome
  FROM people.colaboradores col
  LEFT JOIN people.areas a ON a.id = col.area_id AND a.tenant_id = v_tenant
  WHERE col.user_id = v_user AND col.tenant_id = v_tenant
  LIMIT 1;

  v_can_view_all :=
    EXISTS (SELECT 1 FROM public.get_user_permissions(v_user) p WHERE p.permission_key = '*')
    OR v_area IS NULL
    OR v_area_nome IN ('VLMA', 'Financeiro');

  WITH ts AS (
    -- etapa 1: tudo que foi LANÇADO no período (independe de envio)
    SELECT t.horas, autor.area_id AS autor_area
    FROM operations.timesheets t
    LEFT JOIN people.colaboradores autor ON autor.user_id = t.created_by AND autor.tenant_id = v_tenant
    WHERE t.tenant_id = v_tenant
      AND t.data_lancamento BETWEEN v_inicio AND v_fim
      AND (v_can_view_all OR autor.area_id = v_area OR t.created_by = v_user)
  ),
  bi AS (
    SELECT
      bi.*,
      cli.nome AS cliente_nome,
      ts_colab.area_id AS autor_area
    FROM finance.billing_items bi
    JOIN crm.clientes cli ON cli.id = bi.cliente_id AND cli.tenant_id = bi.tenant_id
    LEFT JOIN operations.timesheets t ON bi.origem_tipo = 'timesheet' AND t.id = bi.origem_id AND t.tenant_id = bi.tenant_id
    LEFT JOIN people.colaboradores ts_colab ON ts_colab.user_id = t.created_by AND ts_colab.tenant_id = bi.tenant_id
    WHERE bi.tenant_id = v_tenant
      AND bi.status NOT IN ('disponivel', 'cancelado')
      AND bi.periodo_inicio >= v_inicio
      AND bi.periodo_fim <= v_fim
      AND (v_can_view_all OR (bi.origem_tipo = 'timesheet' AND ts_colab.area_id = v_area))
  )
  SELECT jsonb_build_object(
    'periodo_inicio', v_inicio,
    'periodo_fim', v_fim,
    'horas_lancadas', COALESCE((SELECT sum(horas) FROM ts), 0),
    'horas_enviadas', COALESCE((SELECT sum(horas_informadas) FROM bi WHERE origem_tipo = 'timesheet'), 0),
    'horas_revisadas', COALESCE((SELECT sum(COALESCE(horas_revisadas, horas_informadas)) FROM bi WHERE origem_tipo = 'timesheet' AND status IN ('em_aprovacao', 'aprovado', 'faturado')), 0),
    'horas_aprovadas', COALESCE((SELECT sum(COALESCE(horas_aprovadas, horas_revisadas, horas_informadas)) FROM bi WHERE origem_tipo = 'timesheet' AND status IN ('aprovado', 'faturado')), 0),
    'horas_ignoradas', COALESCE((SELECT sum(horas_informadas) FROM bi WHERE origem_tipo = 'timesheet' AND status = 'ignorado'), 0),
    'itens_ignorados', COALESCE((SELECT count(*) FROM bi WHERE status = 'ignorado'), 0),
    'valor_ignorado', COALESCE((SELECT sum(COALESCE(valor_informado, 0)) FROM bi WHERE status = 'ignorado'), 0),
    'ignorados_por_motivo', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('motivo', motivo, 'quantidade', qtd, 'horas', horas))
      FROM (
        SELECT COALESCE(NULLIF(snapshot->>'motivo_ignorado', ''), 'Sem justificativa') AS motivo,
               count(*) AS qtd, sum(horas_informadas) AS horas
        FROM bi WHERE status = 'ignorado'
        GROUP BY 1 ORDER BY 2 DESC
      ) m
    ), '[]'::jsonb)
  ) INTO v_resumo;

  WITH bi AS (
    SELECT
      bi.*,
      cli.nome AS cliente_nome,
      ts_colab.area_id AS autor_area
    FROM finance.billing_items bi
    JOIN crm.clientes cli ON cli.id = bi.cliente_id AND cli.tenant_id = bi.tenant_id
    LEFT JOIN operations.timesheets t ON bi.origem_tipo = 'timesheet' AND t.id = bi.origem_id AND t.tenant_id = bi.tenant_id
    LEFT JOIN people.colaboradores ts_colab ON ts_colab.user_id = t.created_by AND ts_colab.tenant_id = bi.tenant_id
    WHERE bi.tenant_id = v_tenant
      AND bi.status NOT IN ('disponivel', 'cancelado')
      AND bi.periodo_inicio >= v_inicio
      AND bi.periodo_fim <= v_fim
      AND (v_can_view_all OR (bi.origem_tipo = 'timesheet' AND ts_colab.area_id = v_area))
  )
  SELECT COALESCE(jsonb_agg(linha ORDER BY (linha->>'projecao_valor')::numeric DESC), '[]'::jsonb)
  INTO v_clientes
  FROM (
    SELECT jsonb_build_object(
      'cliente', cliente_nome,
      'casos', count(DISTINCT caso_id),
      'horas_enviadas', COALESCE(sum(horas_informadas) FILTER (WHERE origem_tipo = 'timesheet'), 0),
      'horas_revisadas', COALESCE(sum(COALESCE(horas_revisadas, horas_informadas)) FILTER (WHERE origem_tipo = 'timesheet' AND status IN ('em_aprovacao', 'aprovado', 'faturado')), 0),
      'horas_aprovadas', COALESCE(sum(COALESCE(horas_aprovadas, horas_revisadas, horas_informadas)) FILTER (WHERE origem_tipo = 'timesheet' AND status IN ('aprovado', 'faturado')), 0),
      'horas_ignoradas', COALESCE(sum(horas_informadas) FILTER (WHERE status = 'ignorado'), 0),
      'projecao_valor', COALESCE(sum(COALESCE(valor_aprovado, valor_revisado, valor_informado, 0)) FILTER (WHERE status <> 'ignorado'), 0)
    ) AS linha
    FROM bi
    GROUP BY cliente_nome
  ) sub;

  RETURN jsonb_build_object('resumo', v_resumo, 'por_cliente', v_clientes);
END;
$function$;

NOTIFY pgrst, 'reload schema';
