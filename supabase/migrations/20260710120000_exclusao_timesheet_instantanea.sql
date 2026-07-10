-- B1: exclusão de timesheet reflete instantaneamente na revisão.
-- 1) delete_timesheet: cancela o billing_item ainda não revisado (órfãos
--    causavam 'enviado por' errado, ex.: Filipe Küster); bloqueia excluir
--    lançamento cujo item já foi revisado/avançou.
-- 2) start_faturamento_flow: snapshot do item timesheet grava o AUTOR
--    (timesheet_profissional) e dados do lançamento — exibição estável.
-- 3) get_revisao_fatura: não lista itens cancelados.

CREATE OR REPLACE FUNCTION public.delete_timesheet(p_user_id uuid, p_timesheet_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_tenant_id uuid;
  v_status text;
BEGIN
  SELECT tenant_id INTO v_tenant_id
  FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id AND tu.status = 'ativo'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não associado a tenant';
  END IF;

  SELECT status INTO v_status
  FROM operations.timesheets
  WHERE id = p_timesheet_id AND tenant_id = v_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lançamento não encontrado';
  END IF;

  IF v_status = 'aprovado' THEN
    RAISE EXCEPTION 'Não é possível excluir um lançamento já aprovado. Reabra a revisão antes.';
  END IF;

  -- Se o lançamento já entrou na fase de revisão E alguém já mexeu nele
  -- (revisou/avançou), a exclusão é bloqueada.
  IF EXISTS (
    SELECT 1
    FROM finance.billing_items bi
    WHERE bi.tenant_id = v_tenant_id
      AND bi.origem_tipo = 'timesheet'
      AND bi.origem_id = p_timesheet_id
      AND (
        bi.status NOT IN ('disponivel', 'em_revisao')
        OR bi.data_revisao IS NOT NULL
        OR EXISTS (
          SELECT 1 FROM finance.revisao_fatura_itens_historico h
          WHERE h.billing_item_id = bi.id AND h.role IN ('REVISOR', 'APROVADOR')
        )
      )
  ) THEN
    RAISE EXCEPTION 'Este lançamento já foi revisado no faturamento. Peça ao revisor para reabrir antes de excluir.';
  END IF;

  -- Cancela o item de faturamento ainda não revisado (evita item órfão na grid).
  UPDATE finance.billing_items bi
  SET status = 'cancelado', updated_at = now(), updated_by = p_user_id
  WHERE bi.tenant_id = v_tenant_id
    AND bi.origem_tipo = 'timesheet'
    AND bi.origem_id = p_timesheet_id
    AND bi.status IN ('disponivel', 'em_revisao');

  DELETE FROM operations.timesheets
  WHERE id = p_timesheet_id AND tenant_id = v_tenant_id;

  RETURN jsonb_build_object('ok', true, 'id', p_timesheet_id);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.start_faturamento_flow(p_user_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_tenant_id uuid;
  v_data_inicio date;
  v_data_fim date;
  v_alvo_tipo varchar;
  v_alvo_id uuid;
  v_alvo_ids uuid[] := ARRAY[]::uuid[];
  v_search text;
  v_batch_id uuid;
  v_batch_numero bigint;
  v_items_count int := 0;
  v_can_write boolean := false;
BEGIN
  SELECT tenant_id INTO v_tenant_id
  FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id
    AND tu.status = 'ativo'
  LIMIT 1;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não associado a tenant';
  END IF;
  SELECT EXISTS (
    SELECT 1
    FROM public.get_user_permissions(p_user_id) p
    WHERE p.permission_key IN (
      'finance.faturamento.write',
      'finance.faturamento.manage',
      'finance.faturamento.*',
      'finance.*',
      '*'
    )
  ) INTO v_can_write;
  IF NOT v_can_write THEN
    RAISE EXCEPTION 'Sem permissão para iniciar fluxo de faturamento';
  END IF;
  v_data_inicio := NULLIF(p_payload->>'data_inicio', '')::date;
  v_data_fim := NULLIF(p_payload->>'data_fim', '')::date;
  v_alvo_tipo := COALESCE(NULLIF(p_payload->>'alvo_tipo', ''), 'itens');
  v_alvo_id := NULLIF(p_payload->>'alvo_id', '')::uuid;
  v_search := NULLIF(trim(COALESCE(p_payload->>'search', '')), '');
  IF jsonb_typeof(p_payload->'alvo_ids') = 'array' THEN
    SELECT COALESCE(array_agg(value::uuid), ARRAY[]::uuid[]) INTO v_alvo_ids
    FROM jsonb_array_elements_text(p_payload->'alvo_ids') AS t(value)
    WHERE value IS NOT NULL
      AND value <> ''
      AND value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
  END IF;
  IF v_alvo_id IS NOT NULL THEN
    v_alvo_ids := array_append(v_alvo_ids, v_alvo_id);
  END IF;
  SELECT COALESCE(array_agg(DISTINCT entry), ARRAY[]::uuid[]) INTO v_alvo_ids
  FROM unnest(v_alvo_ids) AS entry;
  IF v_data_inicio IS NULL OR v_data_fim IS NULL THEN
    RAISE EXCEPTION 'Informe data inicial e final';
  END IF;
  IF v_data_inicio > v_data_fim THEN
    RAISE EXCEPTION 'Data inicial não pode ser maior que data final';
  END IF;
  IF v_alvo_tipo NOT IN ('cliente', 'contrato', 'caso', 'itens') THEN
    RAISE EXCEPTION 'Tipo de alvo inválido';
  END IF;
  IF v_alvo_tipo IN ('cliente', 'contrato', 'caso') AND COALESCE(array_length(v_alvo_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'alvo_id/alvo_ids é obrigatório para cliente/contrato/caso';
  END IF;
  INSERT INTO finance.billing_batches (
    tenant_id,
    status,
    alvo_tipo,
    alvo_id,
    data_inicio,
    data_fim,
    created_by,
    updated_by
  )
  VALUES (
    v_tenant_id,
    'em_revisao',
    v_alvo_tipo,
    CASE WHEN COALESCE(array_length(v_alvo_ids, 1), 0) = 1 THEN v_alvo_ids[1] ELSE NULL END,
    v_data_inicio,
    v_data_fim,
    p_user_id,
    p_user_id
  )
  RETURNING id, numero INTO v_batch_id, v_batch_numero;
  WITH eligible_timesheet AS (
    SELECT
      t.id AS origem_id,
      t.data_lancamento AS data_referencia,
      t.horas AS horas_informadas,
      COALESCE(
        NULLIF((
          CASE
            WHEN jsonb_typeof(cs.regras_financeiras) = 'array' AND jsonb_array_length(cs.regras_financeiras) > 0
              THEN cs.regras_financeiras->0->'regra_cobranca_config'->>'valor_hora'
            ELSE cs.regra_cobranca_config->>'valor_hora'
          END
        ), '')::numeric,
        0
      ) AS valor_hora,
      c.id AS contrato_id,
      c.numero AS contrato_numero,
      c.nome_contrato,
      cli.id AS cliente_id,
      cli.nome AS cliente_nome,
      cs.id AS caso_id,
      cs.numero AS caso_numero,
      cs.nome AS caso_nome,
      t.descricao AS ts_descricao,
      autor.nome AS ts_autor_nome,
      t.created_by AS ts_autor_user_id
    FROM operations.timesheets t
    JOIN contracts.contratos c
      ON c.id = t.contrato_id
     AND c.tenant_id = v_tenant_id
    JOIN crm.clientes cli
      ON cli.id = c.cliente_id
     AND cli.tenant_id = v_tenant_id
    JOIN contracts.casos cs
      ON cs.id = t.caso_id
     AND cs.tenant_id = v_tenant_id
    LEFT JOIN people.colaboradores autor
      ON autor.user_id = t.created_by
     AND autor.tenant_id = v_tenant_id
    WHERE t.tenant_id = v_tenant_id
      AND t.data_lancamento BETWEEN v_data_inicio AND v_data_fim
      AND c.status = 'ativo'
      AND cs.status <> 'inativo'
      AND cs.parte_de_carteira_id IS NULL
      AND (
        v_alvo_tipo = 'itens'
        OR (v_alvo_tipo = 'cliente' AND cli.id = ANY(v_alvo_ids))
        OR (v_alvo_tipo = 'contrato' AND c.id = ANY(v_alvo_ids))
        OR (v_alvo_tipo = 'caso' AND cs.id = ANY(v_alvo_ids))
      )
      AND (
        v_search IS NULL
        OR cli.nome ILIKE '%' || v_search || '%'
        OR c.nome_contrato ILIKE '%' || v_search || '%'
        OR cs.nome ILIKE '%' || v_search || '%'
        OR c.numero::text ILIKE '%' || v_search || '%'
        OR cs.numero::text ILIKE '%' || v_search || '%'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM finance.billing_items bi
        WHERE bi.tenant_id = v_tenant_id
          AND bi.origem_tipo = 'timesheet'
          AND bi.origem_id = t.id
          AND bi.status <> 'cancelado'
      )
  ),
  eligible_rules_source AS (
    SELECT
      c.id AS contrato_id,
      c.numero AS contrato_numero,
      c.nome_contrato,
      cli.id AS cliente_id,
      cli.nome AS cliente_nome,
      cs.id AS caso_id,
      cs.numero AS caso_numero,
      cs.nome AS caso_nome,
      rule_item,
      COALESCE(NULLIF(rule_item->>'id', ''), 'legacy-' || cs.id::text) AS rule_id,
      COALESCE(NULLIF(rule_item->>'regra_cobranca', ''), cs.regra_cobranca, '') AS regra_cobranca,
      COALESCE(rule_item->'regra_cobranca_config', '{}'::jsonb) AS cfg,
      z.dia_inicio_faturamento,
      z.data_inicio_faturamento,
      COALESCE(NULLIF(rule_item->>'status', ''), 'ativo') AS rule_status
    FROM contracts.casos cs
    JOIN contracts.contratos c ON c.id = cs.contrato_id AND c.tenant_id = v_tenant_id
    JOIN crm.clientes cli ON cli.id = c.cliente_id AND cli.tenant_id = v_tenant_id
    CROSS JOIN LATERAL (
      SELECT x AS rule_item
      FROM jsonb_array_elements(
        CASE
          WHEN jsonb_typeof(cs.regras_financeiras) = 'array' AND jsonb_array_length(cs.regras_financeiras) > 0
            THEN cs.regras_financeiras
          ELSE jsonb_build_array(
            jsonb_build_object(
              'id', 'legacy-' || cs.id::text,
              'status', cs.status,
              'regra_cobranca', cs.regra_cobranca,
              'data_inicio_faturamento', cs.data_inicio_faturamento,
              'dia_inicio_faturamento', cs.dia_inicio_faturamento,
              'regra_cobranca_config', COALESCE(cs.regra_cobranca_config, '{}'::jsonb)
            )
          )
        END
      ) AS x
    ) r
    CROSS JOIN LATERAL public.z6_resolve_inicio_faturamento(
      r.rule_item,
      cs.data_inicio_faturamento,
      cs.dia_inicio_faturamento,
      c.created_at::date,
      v_data_inicio
    ) AS z(dia_inicio_faturamento, data_inicio_faturamento)
    WHERE cs.tenant_id = v_tenant_id
      AND c.status = 'ativo'
      AND cs.status <> 'inativo'
      AND cs.parte_de_carteira_id IS NULL
      AND (
        v_alvo_tipo = 'itens'
        OR (v_alvo_tipo = 'cliente' AND cli.id = ANY(v_alvo_ids))
        OR (v_alvo_tipo = 'contrato' AND c.id = ANY(v_alvo_ids))
        OR (v_alvo_tipo = 'caso' AND cs.id = ANY(v_alvo_ids))
      )
      AND (
        v_search IS NULL
        OR cli.nome ILIKE '%' || v_search || '%'
        OR c.nome_contrato ILIKE '%' || v_search || '%'
        OR cs.nome ILIKE '%' || v_search || '%'
        OR c.numero::text ILIKE '%' || v_search || '%'
        OR cs.numero::text ILIKE '%' || v_search || '%'
      )
  ),
  eligible_rules_enriched AS (
    SELECT
      ers.*,
      (
        SELECT sm.valor
        FROM config.salario_minimo sm
        WHERE sm.tenant_id = v_tenant_id
          AND sm.vigencia_desde <= GREATEST(ers.data_inicio_faturamento, v_data_inicio)::date
        ORDER BY sm.vigencia_desde DESC
        LIMIT 1
      ) AS valor_sm_ref
    FROM eligible_rules_source ers
  ),
  eligible_rules_calc AS (
    SELECT
      ers.*,
      finance.rule_origin_uuid(ers.caso_id, ers.rule_id) AS origem_id,
      CASE
        WHEN ers.regra_cobranca IN ('mensal', 'mensalidade_processo') THEN
          COALESCE(NULLIF(ers.cfg->>'valor_mensal', '')::numeric, 0)
          * GREATEST(
              0,
              (
                SELECt count(*)::numeric
                FROM generate_series(
                  date_trunc('month', GREATEST(ers.data_inicio_faturamento, v_data_inicio))::date,
                  date_trunc('month', v_data_fim)::date,
                  interval '1 month'
                ) AS gs(ref_mes)
                WHERE (
                  date_trunc('month', gs.ref_mes) <> date_trunc('month', CURRENT_DATE)
                  OR COALESCE(
                    ers.dia_inicio_faturamento,
                    EXTRACT(DAY FROM ers.data_inicio_faturamento)::integer,
                    1
                  ) <= EXTRACT(DAY FROM CURRENT_DATE)::integer
                )
              )
            )
        WHEN ers.regra_cobranca = 'mensalidade_carteira' THEN
          COALESCE(NULLIF(ers.cfg->>'valor_mensal_carteira', '')::numeric, 0)
          * GREATEST(
              0,
              (
                SELECt count(*)::numeric
                FROM generate_series(
                  date_trunc('month', GREATEST(ers.data_inicio_faturamento, v_data_inicio))::date,
                  date_trunc('month', v_data_fim)::date,
                  interval '1 month'
                ) AS gs(ref_mes)
                WHERE (
                  date_trunc('month', gs.ref_mes) <> date_trunc('month', CURRENT_DATE)
                  OR COALESCE(
                    ers.dia_inicio_faturamento,
                    EXTRACT(DAY FROM ers.data_inicio_faturamento)::integer,
                    1
                  ) <= EXTRACT(DAY FROM CURRENT_DATE)::integer
                )
              )
            )
        WHEN ers.regra_cobranca = 'projeto' THEN
          CASE
            WHEN jsonb_typeof(ers.cfg->'parcelas') = 'array' AND jsonb_array_length(ers.cfg->'parcelas') > 0 THEN
              COALESCE((
                SELECT SUM(COALESCE(NULLIF(p->>'valor', '')::numeric, 0))
                FROM jsonb_array_elements(ers.cfg->'parcelas') p
                WHERE NULLIF(p->>'data_pagamento', '')::date BETWEEN v_data_inicio AND v_data_fim
              ), 0)
            WHEN ers.data_inicio_faturamento BETWEEN v_data_inicio AND v_data_fim THEN
              COALESCE(NULLIF(ers.cfg->>'valor_projeto', '')::numeric, 0)
            ELSE 0
          END
        WHEN ers.regra_cobranca = 'exito' THEN
          CASE
            WHEN NULLIF(ers.cfg->>'data_pagamento_exito', '')::date BETWEEN v_data_inicio AND v_data_fim THEN
              COALESCE(
                NULLIF(ers.cfg->>'valor_exito_calculado', '')::numeric,
                (COALESCE(NULLIF(ers.cfg->>'valor_acao', '')::numeric, 0)
                  * COALESCE(NULLIF(ers.cfg->>'percentual_exito', '')::numeric, 0) / 100.0)
              )
            ELSE 0
          END
        WHEN ers.regra_cobranca = 'salario_minimo' THEN
          COALESCE(NULLIF(ers.rule_item->>'quantidade_sm', '')::numeric, NULLIF(ers.cfg->>'quantidade_sm', '')::numeric, 0)
          * COALESCE(ers.valor_sm_ref, 0)
        ELSE 0
      END::numeric(14,2) AS valor_regra
    FROM eligible_rules_enriched ers
    WHERE ers.regra_cobranca IN ('mensal', 'mensalidade_processo', 'mensalidade_carteira', 'projeto', 'exito', 'salario_minimo')
      AND ers.rule_status = 'ativo'
  ),
  inserted_timesheet AS (
    INSERT INTO finance.billing_items (
      tenant_id,
      billing_batch_id,
      cliente_id,
      contrato_id,
      caso_id,
      origem_tipo,
      origem_id,
      data_referencia,
      periodo_inicio,
      periodo_fim,
      status,
      valor_informado,
      horas_informadas,
      snapshot,
      created_by,
      updated_by
    )
    SELECT
      v_tenant_id,
      v_batch_id,
      e.cliente_id,
      e.contrato_id,
      e.caso_id,
      'timesheet',
      e.origem_id,
      e.data_referencia,
      v_data_inicio,
      v_data_fim,
      'em_revisao',
      (COALESCE(e.horas_informadas, 0) * COALESCE(e.valor_hora, 0))::numeric(14,2),
      e.horas_informadas,
      jsonb_build_object(
        'cliente_id', e.cliente_id,
        'cliente_nome', e.cliente_nome,
        'contrato_id', e.contrato_id,
        'contrato_numero', e.contrato_numero,
        'contrato_nome', e.nome_contrato,
        'caso_id', e.caso_id,
        'caso_numero', e.caso_numero,
        'caso_nome', e.caso_nome,
        'valor_hora', COALESCE(e.valor_hora, 0),
        'origem', 'timesheet',
        -- autor do lançamento: exibição estável mesmo se o timesheet sumir depois
        'timesheet_profissional', COALESCE(e.ts_autor_nome, ''),
        'timesheet_autor_user_id', e.ts_autor_user_id,
        'timesheet_data_lancamento', e.data_referencia::text,
        'timesheet_descricao', COALESCE(e.ts_descricao, ''),
        'timesheet_horas', COALESCE(e.horas_informadas, 0)
      ),
      p_user_id,
      p_user_id
    FROM eligible_timesheet e
    RETURNING id
  ),
  inserted_regras AS (
    INSERT INTO finance.billing_items (
      tenant_id,
      billing_batch_id,
      cliente_id,
      contrato_id,
      caso_id,
      origem_tipo,
      origem_id,
      data_referencia,
      periodo_inicio,
      periodo_fim,
      status,
      valor_informado,
      horas_informadas,
      snapshot,
      created_by,
      updated_by
    )
    SELECT
      v_tenant_id,
      v_batch_id,
      r.cliente_id,
      r.contrato_id,
      r.caso_id,
      'regra_financeira',
      r.origem_id,
      GREATEST(r.data_inicio_faturamento, v_data_inicio),
      v_data_inicio,
      v_data_fim,
      'em_revisao',
      COALESCE(r.valor_regra, 0)::numeric(14,2),
      0,
      jsonb_build_object(
        'cliente_id', r.cliente_id,
        'cliente_nome', r.cliente_nome,
        'contrato_id', r.contrato_id,
        'contrato_numero', r.contrato_numero,
        'contrato_nome', r.nome_contrato,
        'caso_id', r.caso_id,
        'caso_numero', r.caso_numero,
        'caso_nome', r.caso_nome,
        'regra_id', r.rule_id,
        'regra_cobranca', r.regra_cobranca,
        'origem', 'regra_financeira',
        'regra', CASE WHEN r.regra_cobranca = 'salario_minimo' THEN 'salario_minimo' ELSE NULL END,
        'quantidade_sm', CASE WHEN r.regra_cobranca = 'salario_minimo' THEN COALESCE(NULLIF(r.rule_item->>'quantidade_sm', '')::numeric, NULLIF(r.cfg->>'quantidade_sm', '')::numeric) ELSE NULL END,
        'valor_sm_no_lancamento', CASE WHEN r.regra_cobranca = 'salario_minimo' THEN r.valor_sm_ref ELSE NULL END
      ),
      p_user_id,
      p_user_id
    FROM eligible_rules_calc r
    WHERE r.valor_regra > 0
      AND NOT EXISTS (
        SELECT 1
        FROM finance.billing_items bi
        WHERE bi.tenant_id = v_tenant_id
          AND bi.origem_tipo = 'regra_financeira'
          AND bi.origem_id = r.origem_id
          AND bi.periodo_inicio = v_data_inicio
          AND bi.periodo_fim = v_data_fim
          AND bi.status <> 'cancelado'
      )
    RETURNING id
  )
  SELECT
    COALESCE((SELECT count(*) FROM inserted_timesheet), 0)
    + COALESCE((SELECt count(*) FROM inserted_regras), 0)
  INTO v_items_count;
  IF v_items_count = 0 THEN
    DELETE FROM finance.billing_batches WHERE id = v_batch_id;
    RAISE EXCEPTION 'Nenhum item elegível encontrado para o período/filtro';
  END IF;
  UPDATE operations.timesheets t
  SET
    status = 'revisao',
    updated_at = now(),
    updated_by = p_user_id
  WHERE t.tenant_id = v_tenant_id
    AND t.id IN (
      SELECT bi.origem_id
      FROM finance.billing_items bi
      WHERE bi.tenant_id = v_tenant_id
        AND bi.billing_batch_id = v_batch_id
        AND bi.origem_tipo = 'timesheet'
    )
    AND t.status = 'em_lancamento';
  RETURN jsonb_build_object(
    'batch_id', v_batch_id,
    'batch_numero', v_batch_numero,
    'itens_criados', v_items_count
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_revisao_fatura(p_user_id uuid, p_status character varying DEFAULT NULL::character varying, p_lote text DEFAULT NULL::text, p_cliente text DEFAULT NULL::text, p_contrato text DEFAULT NULL::text, p_caso text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_tenant_id uuid;
  v_can_read boolean := false;
  v_can_view_all boolean := false;
  v_viewer_area_id uuid;
  v_viewer_area_nome text;
BEGIN
  SELECT tenant_id INTO v_tenant_id
  FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id
    AND tu.status = 'ativo'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não associado a tenant';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.get_user_permissions(p_user_id) p
    WHERE p.permission_key IN (
      'finance.faturamento.read',
      'finance.faturamento.review',
      'finance.faturamento.approve',
      'finance.faturamento.manage',
      'finance.faturamento.*',
      'finance.*',
      '*'
    )
  ) INTO v_can_read;

  IF NOT v_can_read THEN
    RAISE EXCEPTION 'Sem permissão para visualizar revisão de fatura';
  END IF;

  SELECT col.area_id, a.nome
  INTO v_viewer_area_id, v_viewer_area_nome
  FROM people.colaboradores col
  LEFT JOIN people.areas a ON a.id = col.area_id AND a.tenant_id = v_tenant_id
  WHERE col.user_id = p_user_id AND col.tenant_id = v_tenant_id
  LIMIT 1;

  -- Vê tudo: diretores (centro de custo 'VLMA'), financeiro, sem área, ou super-admin ('*').
  -- Obs.: NÃO usar finance.faturamento.* aqui — sócios de área (ex.: Leo) também têm
  -- essas permissões; a distinção é o centro de custo. gestor de área -> escopado.
  v_can_view_all :=
    EXISTS (SELECT 1 FROM public.get_user_permissions(p_user_id) p WHERE p.permission_key = '*')
    OR v_viewer_area_id IS NULL
    OR v_viewer_area_nome IN ('VLMA', 'Financeiro');

  RETURN (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'billing_item_id', bi.id,
          'item_numero', bi.numero,
          'billing_batch_id', bi.billing_batch_id,
          'batch_numero', b.numero,
          'status', bi.status,
          'origem_tipo', bi.origem_tipo,
          'data_referencia', bi.data_referencia,
          'cliente_id', cli.id,
          'cliente_nome', cli.nome,
          'contrato_id', c.id,
          'contrato_numero', c.numero,
          'contrato_nome', c.nome_contrato,
          'caso_id', cs.id,
          'caso_numero', cs.numero,
          'caso_nome', cs.nome,
          'regra_nome', COALESCE(
            NULLIF(bi.snapshot->>'regra_nome', ''),
            NULLIF(bi.snapshot->>'descricao', ''),
            CASE WHEN bi.origem_tipo = 'timesheet' THEN 'Timesheet' ELSE 'Regra financeira' END
          ),
          -- regra_cobranca do CASO (não do snapshot): permite ao front agrupar
          -- horas de casos 'projeto' na aba Projeto em vez de Horas.
          'caso_regra_cobranca', COALESCE(
            NULLIF(bi.snapshot->>'regra_cobranca', ''),
            NULLIF(cs.regra_cobranca, ''),
            CASE
              WHEN jsonb_typeof(cs.regras_financeiras) = 'array' AND jsonb_array_length(cs.regras_financeiras) > 0
                THEN NULLIF(cs.regras_financeiras->0->>'regra_cobranca', '')
            END
          ),
          'horas_informadas', CASE WHEN bi.origem_tipo = 'timesheet' THEN bi.horas_informadas ELSE 0::numeric END,
          'horas_revisadas', CASE WHEN bi.origem_tipo = 'timesheet' THEN bi.horas_revisadas ELSE 0::numeric END,
          'horas_aprovadas', CASE WHEN bi.origem_tipo = 'timesheet' THEN bi.horas_aprovadas ELSE 0::numeric END,
          'valor_informado', bi.valor_informado,
          'valor_revisado', bi.valor_revisado,
          'valor_aprovado', bi.valor_aprovado,
          'data_revisao', bi.data_revisao,
          'data_aprovacao', bi.data_aprovacao,
          'responsavel_revisao_id', bi.responsavel_revisao_id,
          'responsavel_aprovacao_id', bi.responsavel_aprovacao_id,
          'responsavel_revisao_nome', COALESCE(rev_actor_colab.nome, rev_colab.nome, auto_rev.nome),
          'responsavel_aprovacao_nome', COALESCE(apr_actor_colab.nome, apr_colab.nome),
          'responsavel_fluxo_nome', CASE
            WHEN bi.status = 'em_revisao' THEN COALESCE(rev_actor_colab.nome, rev_colab.nome, auto_rev.nome)
            WHEN bi.status = 'em_aprovacao' THEN COALESCE(apr_actor_colab.nome, apr_colab.nome)
            ELSE NULL
          END,
          'enviado_por_id', COALESCE(t.created_by, bi.created_by),
          'enviado_por_nome', COALESCE(
            NULLIF(bi.snapshot->>'timesheet_profissional', ''),
            ts_colab.nome,
            orig_colab.nome
          ),
          'timesheet_id', CASE WHEN bi.origem_tipo = 'timesheet' THEN t.id ELSE NULL END,
          'timesheet_data_lancamento', COALESCE(
            NULLIF(bi.snapshot->>'timesheet_data_lancamento', ''),
            CASE WHEN t.data_lancamento IS NOT NULL THEN t.data_lancamento::text ELSE NULL END
          ),
          'timesheet_horas', CASE
            WHEN bi.origem_tipo = 'timesheet' THEN COALESCE(
              NULLIF(bi.snapshot->>'timesheet_horas', '')::numeric,
              t.horas,
              bi.horas_informadas,
              0
            )
            ELSE 0::numeric
          END,
          'timesheet_descricao', COALESCE(
            NULLIF(bi.snapshot->>'timesheet_descricao', ''),
            t.descricao,
            ''
          ),
          'timesheet_profissional', COALESCE(
            NULLIF(bi.snapshot->>'timesheet_profissional', ''),
            ts_colab.nome,
            ''
          ),
          'timesheet_valor_hora', COALESCE(
            NULLIF(bi.snapshot->>'timesheet_valor_hora', '')::numeric,
            NULLIF(bi.snapshot->>'valor_hora', '')::numeric,
            CASE
              WHEN bi.origem_tipo = 'timesheet' AND COALESCE(t.horas, bi.horas_informadas, 0) > 0
                THEN COALESCE(bi.valor_informado, 0) / COALESCE(t.horas, bi.horas_informadas)
              ELSE 0
            END
          ),
          'snapshot', bi.snapshot,
          'updated_at', bi.updated_at,
          'historico', COALESCE(rfih.hist, '[]'::jsonb)
        )
        ORDER BY cli.nome, c.numero NULLS LAST, cs.numero NULLS LAST, bi.numero
      ),
      '[]'::jsonb
    )
    FROM finance.billing_items bi
    LEFT JOIN finance.billing_batches b
      ON b.id = bi.billing_batch_id
     AND b.tenant_id = bi.tenant_id
    JOIN crm.clientes cli
      ON cli.id = bi.cliente_id
     AND cli.tenant_id = bi.tenant_id
    JOIN contracts.contratos c
      ON c.id = bi.contrato_id
     AND c.tenant_id = bi.tenant_id
    JOIN contracts.casos cs
      ON cs.id = bi.caso_id
     AND cs.tenant_id = bi.tenant_id
    LEFT JOIN LATERAL (
      SELECT NULLIF(r->>'colaborador_id', '')::uuid AS colaborador_id
      FROM jsonb_array_elements(COALESCE(cs.timesheet_config->'revisores', '[]'::jsonb)) r
      ORDER BY COALESCE(NULLIF(r->>'ordem', '')::int, 999999)
      LIMIT 1
    ) rev_cfg ON true
    LEFT JOIN LATERAL (
      SELECT NULLIF(a->>'colaborador_id', '')::uuid AS colaborador_id
      FROM jsonb_array_elements(COALESCE(cs.timesheet_config->'aprovadores', '[]'::jsonb)) a
      ORDER BY COALESCE(NULLIF(a->>'ordem', '')::int, 999999)
      LIMIT 1
    ) apr_cfg ON true
    LEFT JOIN people.colaboradores rev_colab
      ON rev_colab.id = rev_cfg.colaborador_id
     AND rev_colab.tenant_id = bi.tenant_id
    LEFT JOIN people.colaboradores apr_colab
      ON apr_colab.id = apr_cfg.colaborador_id
     AND apr_colab.tenant_id = bi.tenant_id
    LEFT JOIN people.colaboradores rev_actor_colab
      ON rev_actor_colab.user_id = bi.responsavel_revisao_id
     AND rev_actor_colab.tenant_id = bi.tenant_id
    LEFT JOIN people.colaboradores apr_actor_colab
      ON apr_actor_colab.user_id = bi.responsavel_aprovacao_id
     AND apr_actor_colab.tenant_id = bi.tenant_id
    LEFT JOIN operations.timesheets t
      ON bi.origem_tipo = 'timesheet'
     AND t.id = bi.origem_id
     AND t.tenant_id = bi.tenant_id
    LEFT JOIN people.colaboradores ts_colab
      ON ts_colab.user_id = t.created_by
     AND ts_colab.tenant_id = bi.tenant_id
    -- Área do item: p/ timesheet = área do autor; senão = 1º centro de custo do rateio do caso.
    LEFT JOIN LATERAL (
      SELECT COALESCE(
        ts_colab.area_id,
        (SELECT NULLIF(rr->>'centro_custo_id', '')::uuid
           FROM jsonb_array_elements(CASE WHEN jsonb_typeof(cs.centro_custo_rateio) = 'array' THEN cs.centro_custo_rateio ELSE '[]'::jsonb END) rr
           WHERE NULLIF(rr->>'centro_custo_id', '') IS NOT NULL
           LIMIT 1)
      ) AS area_id
    ) ia ON true
    -- Revisor automático por centro de custo = coordenador da área do item.
    LEFT JOIN LATERAL (
      SELECT co.nome
      FROM people.colaboradores co
      WHERE co.tenant_id = bi.tenant_id
        AND co.area_id = ia.area_id
        AND COALESCE(co.eh_coordenador, false) = true
      ORDER BY co.nome
      LIMIT 1
    ) auto_rev ON (cs.timesheet_config->>'revisores_modo') = 'auto_centro_custo'
    LEFT JOIN people.colaboradores orig_colab
      ON orig_colab.user_id = bi.created_by
     AND orig_colab.tenant_id = bi.tenant_id
    LEFT JOIN LATERAL (
      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'id', h.id,
            'role', h.role,
            'author_id', h.author_id,
            'author_name', COALESCE(c_hist.nome, h.author_name),
            'horas', h.horas,
            'valor', h.valor,
            'texto', h.texto,
            'created_at', h.created_at
          ) ORDER BY h.created_at ASC
        ),
        '[]'::jsonb
      ) AS hist
      FROM finance.revisao_fatura_itens_historico h
      LEFT JOIN people.colaboradores c_hist
        ON c_hist.user_id = h.author_id AND c_hist.tenant_id = h.tenant_id
      WHERE h.billing_item_id = bi.id AND h.tenant_id = bi.tenant_id
    ) rfih ON true
    WHERE bi.tenant_id = v_tenant_id
      AND bi.status NOT IN ('disponivel', 'cancelado')
      AND (
        v_can_view_all
        -- item de timesheet: área do autor = área do gestor
        OR (bi.origem_tipo = 'timesheet' AND ts_colab.area_id = v_viewer_area_id)
        -- qualquer item: centro de custo (rateio) do caso inclui a área do gestor
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements(CASE WHEN jsonb_typeof(cs.centro_custo_rateio) = 'array' THEN cs.centro_custo_rateio ELSE '[]'::jsonb END) rr
          WHERE NULLIF(rr->>'centro_custo_id', '')::uuid = v_viewer_area_id
        )
      )
      AND (
        p_status IS NULL
        OR trim(p_status) = ''
        OR bi.status = trim(p_status)
      )
      AND (
        p_cliente IS NULL
        OR trim(p_cliente) = ''
        OR cli.nome ILIKE '%' || trim(p_cliente) || '%'
      )
      AND (
        p_contrato IS NULL
        OR trim(p_contrato) = ''
        OR c.nome_contrato ILIKE '%' || trim(p_contrato) || '%'
        OR c.numero::text ILIKE '%' || trim(p_contrato) || '%'
      )
      AND (
        p_caso IS NULL
        OR trim(p_caso) = ''
        OR cs.nome ILIKE '%' || trim(p_caso) || '%'
        OR cs.numero::text ILIKE '%' || trim(p_caso) || '%'
      )
  );
END;
$function$
;

NOTIFY pgrst, 'reload schema';
