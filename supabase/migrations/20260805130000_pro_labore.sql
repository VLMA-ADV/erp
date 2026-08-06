-- CT6 · Pro-labore (pedido Filipe 04/08).
-- O cliente confirmou: e um clone de "projeto" — mesma logica, so muda o nome,
-- e vira parcelado do mesmo jeito quando se cadastra mais de uma parcela.
--
-- Por isso NAO duplicamos a regra: onde o codigo perguntava "e projeto?",
-- passa a perguntar "e projeto ou pro-labore?". Assim as duas nao podem
-- divergir com o tempo, que e o que aconteceria com copia e cola.

ALTER TABLE contracts.casos DROP CONSTRAINT IF EXISTS casos_regra_cobranca_check;
ALTER TABLE contracts.casos ADD CONSTRAINT casos_regra_cobranca_check
  CHECK (regra_cobranca IS NULL OR regra_cobranca::text = ANY (ARRAY[
    'hora', 'hora_com_cap', 'mensal', 'mensalidade_processo', 'salario_minimo',
    'mensalidade_carteira', 'projeto', 'projeto_parcelado',
    'pro_labore', 'pro_labore_parcelado', 'exito'
  ]));

CREATE OR REPLACE FUNCTION public.get_caso_resumo(p_caso_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'contracts', 'people', 'core'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid;
  v_caso contracts.casos%ROWTYPE;
  v_regra text;
  v_regra_label text;
  v_cfg jsonb;
  v_valor numeric;
  v_unidade text := '';
  v_cc text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  SELECT tu.tenant_id INTO v_tenant FROM core.tenant_users tu
   WHERE tu.user_id = v_uid AND tu.status='ativo' LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;

  SELECT * INTO v_caso FROM contracts.casos WHERE id = p_caso_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Caso não encontrado'; END IF;

  v_regra := lower(coalesce(nullif(v_caso.regra_cobranca, ''), ''));
  v_regra_label := CASE v_regra
    WHEN 'hora' THEN 'Hora'
    WHEN 'projeto' THEN 'Projeto'
    WHEN 'pro_labore' THEN 'Pro-labore'
    WHEN 'pro_labore_parcelado' THEN 'Pro-labore parcelado'
    WHEN 'projeto_parcelado' THEN 'Projeto parcelado'
    WHEN 'mensal' THEN 'Mensalidade'
    WHEN 'mensalidade_processo' THEN 'Mensalidade de processo'
    WHEN 'mensalidade_carteira' THEN 'Mensalidade de carteira'
    WHEN 'salario_minimo' THEN 'Mensalidade de processo'
    WHEN 'exito' THEN 'Êxito'
    WHEN '' THEN 'Sem regra'
    ELSE initcap(replace(v_regra, '_', ' '))
  END;

  v_cfg := coalesce(v_caso.regra_cobranca_config, '{}'::jsonb);
  v_valor := CASE v_regra
    WHEN 'projeto' THEN nullif(v_cfg->>'valor_projeto', '')::numeric
    WHEN 'pro_labore' THEN nullif(v_cfg->>'valor_projeto', '')::numeric
    WHEN 'pro_labore_parcelado' THEN nullif(v_cfg->>'valor_projeto', '')::numeric
    WHEN 'projeto_parcelado' THEN nullif(v_cfg->>'valor_projeto', '')::numeric
    WHEN 'hora' THEN nullif(v_cfg->>'valor_hora', '')::numeric
    WHEN 'mensal' THEN nullif(v_cfg->>'valor_mensal', '')::numeric
    WHEN 'mensalidade_processo' THEN nullif(v_cfg->>'valor_mensal', '')::numeric
    WHEN 'mensalidade_carteira' THEN nullif(v_cfg->>'valor_mensal', '')::numeric
    ELSE NULL
  END;
  v_unidade := CASE v_regra
    WHEN 'hora' THEN '/h'
    WHEN 'mensal' THEN '/mês'
    WHEN 'mensalidade_processo' THEN '/mês'
    WHEN 'mensalidade_carteira' THEN '/mês'
    ELSE ''
  END;

  -- Centro de custo: rateio -> nomes de área (com % se houver mais de um)
  SELECT string_agg(
           coalesce(a.nome, 'Sem área')
             || CASE WHEN jsonb_array_length(coalesce(v_caso.centro_custo_rateio, '[]'::jsonb)) > 1
                     THEN ' ' || round(coalesce((elem->>'percentual')::numeric, 0)) || '%'
                     ELSE '' END,
           ' · ' ORDER BY (elem->>'percentual')::numeric DESC NULLS LAST)
    INTO v_cc
  FROM jsonb_array_elements(coalesce(v_caso.centro_custo_rateio, '[]'::jsonb)) AS elem
  LEFT JOIN people.areas a ON a.id = nullif(elem->>'centro_custo_id', '')::uuid;

  RETURN jsonb_build_object(
    'caso_id', v_caso.id,
    'numero', v_caso.numero,
    'nome', v_caso.nome,
    'regra', v_regra,
    'regra_label', v_regra_label,
    'produto', (SELECT p.nome FROM contracts.produtos p WHERE p.id = v_caso.produto_id),
    'responsavel', (SELECT k.nome FROM people.colaboradores k WHERE k.id = v_caso.responsavel_id),
    'centro_custo', v_cc,
    'valor', v_valor,
    'valor_unidade', v_unidade
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_valor_fechado_regra(p_user_id uuid, p_ref_month date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'contracts', 'core'
AS $function$
DECLARE v_tenant uuid; v_ini date; v_fim date;
BEGIN
  SELECT tenant_id INTO v_tenant FROM core.tenant_users WHERE user_id=p_user_id AND status='ativo' LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;
  v_ini := date_trunc('month', COALESCE(p_ref_month, (now() AT TIME ZONE 'America/Sao_Paulo')::date))::date;
  v_fim := (v_ini + interval '1 month')::date;

  RETURN jsonb_build_object(
    'mes', to_char(v_ini, 'YYYY-MM'),
    'itens', (SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.valor DESC), '[]'::jsonb) FROM (
      SELECT
        COALESCE(NULLIF(c.regra_cobranca,''), 'sem_regra') AS regra,
        count(*)::int AS qtd,
        COALESCE(round(sum(
          CASE c.regra_cobranca
            WHEN 'projeto' THEN NULLIF(c.regra_cobranca_config->>'valor_projeto','')::numeric
    WHEN 'pro_labore' THEN NULLIF(c.regra_cobranca_config->>'valor_projeto','')::numeric
    WHEN 'pro_labore_parcelado' THEN NULLIF(c.regra_cobranca_config->>'valor_projeto','')::numeric
            WHEN 'hora' THEN NULLIF(c.regra_cobranca_config->>'valor_hora','')::numeric
            WHEN 'mensal' THEN NULLIF(c.regra_cobranca_config->>'valor_mensal','')::numeric * 12
            WHEN 'mensalidade_processo' THEN NULLIF(c.regra_cobranca_config->>'valor_mensal','')::numeric * 12
            WHEN 'mensalidade_carteira' THEN NULLIF(c.regra_cobranca_config->>'valor_mensal','')::numeric * 12
            WHEN 'salario_minimo' THEN NULLIF(c.regra_cobranca_config->>'valor_mensal','')::numeric * 12
            WHEN 'exito' THEN COALESCE(NULLIF(c.regra_cobranca_config->>'exito_valor_fixo','')::numeric, NULLIF(c.regra_cobranca_config->>'valor_acao','')::numeric)
            ELSE NULL
          END
        ), 2), 0) AS valor
      FROM contracts.casos c
      WHERE c.tenant_id = v_tenant
        AND c.created_at >= v_ini AND c.created_at < v_fim
        AND c.parte_de_carteira_id IS NULL
      GROUP BY 1
    ) x)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_itens_a_faturar(p_user_id uuid, p_data_inicio date, p_data_fim date, p_search text DEFAULT NULL::text)
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

  IF p_data_inicio IS NULL OR p_data_fim IS NULL THEN
    RAISE EXCEPTION 'Informe data inicial e final';
  END IF;

  IF p_data_inicio > p_data_fim THEN
    RAISE EXCEPTION 'Data inicial não pode ser maior que data final';
  END IF;

  RETURN (
    WITH base_timesheet AS (
      SELECT
        t.id AS origem_id,
        t.data_lancamento::date AS data_referencia,
        t.horas::numeric(12,2) AS horas,
        (
          COALESCE(t.horas, 0)
          * COALESCE(public.resolver_valor_hora(cs.id, t.cargo_id), 0)
        )::numeric(14,2) AS valor,
        c.id AS contrato_id,
        c.numero AS contrato_numero,
        c.numero_sequencial AS contrato_numero_sequencial,
        c.nome_contrato,
        cli.id AS cliente_id,
        cli.nome AS cliente_nome,
        cs.id AS caso_id,
        cs.numero AS caso_numero,
        cs.nome AS caso_nome,
        'timesheet'::text AS item_tipo,
        -- aba Horas só quando o caso cobra por hora; sem regra => sem aba (Todas)
        (CASE
          WHEN EXISTS (
            SELECT 1 FROM jsonb_array_elements(
              CASE WHEN jsonb_typeof(cs.regras_financeiras) = 'array' THEN cs.regras_financeiras ELSE '[]'::jsonb END
            ) r
            WHERE COALESCE(NULLIF(r->>'status',''),'ativo') = 'ativo'
              AND NULLIF(r->>'regra_cobranca','') IN ('hora','hora_com_cap')
          ) OR NULLIF(cs.regra_cobranca,'') IN ('hora','hora_com_cap') THEN 'hora'
          ELSE COALESCE(
            (
              SELECT NULLIF(r->>'regra_cobranca','') FROM jsonb_array_elements(
                CASE WHEN jsonb_typeof(cs.regras_financeiras) = 'array' THEN cs.regras_financeiras ELSE '[]'::jsonb END
              ) r
              WHERE COALESCE(NULLIF(r->>'status',''),'ativo') = 'ativo'
                AND NULLIF(r->>'regra_cobranca','') IS NOT NULL
              LIMIT 1
            ),
            NULLIF(cs.regra_cobranca, '')
          )
        END)::text AS caso_regra,
        COALESCE(NULLIF(t.descricao, ''), 'Timesheet - ' || to_char(t.data_lancamento::date, 'DD/MM/YYYY'))::text AS descricao,
        COALESCE(aut.nome, '')::text AS lancado_por
      FROM operations.timesheets t
      LEFT JOIN people.colaboradores aut ON aut.user_id = t.created_by AND aut.tenant_id = v_tenant_id
      JOIN contracts.contratos c ON c.id = t.contrato_id AND c.tenant_id = v_tenant_id
      JOIN crm.clientes cli ON cli.id = c.cliente_id AND cli.tenant_id = v_tenant_id
      JOIN contracts.casos cs ON cs.id = t.caso_id AND cs.tenant_id = v_tenant_id
      WHERE t.tenant_id = v_tenant_id
        AND t.data_lancamento::date BETWEEN p_data_inicio AND p_data_fim
        AND c.status = 'ativo'
        AND cs.status <> 'inativo'
        AND NOT EXISTS (
          SELECT 1
          FROM finance.billing_items bi
          WHERE bi.tenant_id = v_tenant_id
            AND bi.origem_tipo = 'timesheet'
            AND bi.origem_id = t.id
            AND bi.status <> 'cancelado'
        )
        AND (
          p_search IS NULL
          OR trim(p_search) = ''
          OR cli.nome ILIKE '%' || trim(p_search) || '%'
          OR c.nome_contrato ILIKE '%' || trim(p_search) || '%'
          OR cs.nome ILIKE '%' || trim(p_search) || '%'
          OR c.numero::text ILIKE '%' || trim(p_search) || '%'
          OR cs.numero::text ILIKE '%' || trim(p_search) || '%'
        )
    ),
    rules_source AS (
      SELECT
        c.id AS contrato_id,
        c.numero AS contrato_numero,
        c.numero_sequencial AS contrato_numero_sequencial,
        c.nome_contrato,
        cli.id AS cliente_id,
        cli.nome AS cliente_nome,
        cs.id AS caso_id,
        cs.numero AS caso_numero,
        cs.nome AS caso_nome,
        COALESCE(NULLIF(rule_item->>'id', ''), 'legacy-' || cs.id::text) AS rule_id,
        COALESCE(NULLIF(rule_item->>'regra_cobranca', ''), cs.regra_cobranca, '') AS regra_cobranca,
        COALESCE(rule_item->'regra_cobranca_config', '{}'::jsonb) AS cfg,
        z.dia_inicio_faturamento,
        z.data_inicio_faturamento,
        COALESCE(NULLIF(rule_item->>'status', ''), 'ativo') AS rule_status,
        finance.rule_origin_uuid(cs.id, COALESCE(NULLIF(rule_item->>'id', ''), 'legacy-' || cs.id::text)) AS origem_regra_id
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
        p_data_inicio
      ) AS z(dia_inicio_faturamento, data_inicio_faturamento)
      WHERE cs.tenant_id = v_tenant_id
        AND c.status = 'ativo'
        AND cs.status = 'ativo'
        AND (
          p_search IS NULL
          OR trim(p_search) = ''
          OR cli.nome ILIKE '%' || trim(p_search) || '%'
          OR c.nome_contrato ILIKE '%' || trim(p_search) || '%'
          OR cs.nome ILIKE '%' || trim(p_search) || '%'
          OR c.numero::text ILIKE '%' || trim(p_search) || '%'
          OR cs.numero::text ILIKE '%' || trim(p_search) || '%'
        )
    ),
    regra_mensal_itens AS (
      SELECT
        finance.rule_origin_uuid(rs.caso_id, rs.rule_id || ':mensal:' || to_char(gs.ref_mes, 'YYYYMM')) AS origem_id,
        rs.origem_regra_id,
        gs.ref_mes::date AS data_referencia,
        0::numeric(12,2) AS horas,
        val.valor::numeric(14,2) AS valor,
        rs.contrato_id,
        rs.contrato_numero,
        rs.contrato_numero_sequencial,
        rs.nome_contrato,
        rs.cliente_id,
        rs.cliente_nome,
        rs.caso_id,
        rs.caso_numero,
        rs.caso_nome,
        -- salário mínimo é apresentado como "Mensalidade de processo" no app (form),
        -- então cai na mesma aba da grid.
        CASE WHEN rs.regra_cobranca = 'salario_minimo' THEN 'mensalidade_processo' ELSE rs.regra_cobranca END AS item_tipo,
        (
          CASE
            WHEN rs.regra_cobranca IN ('mensalidade_processo', 'salario_minimo') THEN 'Mensalidade de processo'
            ELSE 'Mensalidade'
          END
          || ' - ' || to_char(gs.ref_mes, 'MM/YYYY')
        )::text AS descricao,
        ''::text AS lancado_por
      FROM rules_source rs
      JOIN LATERAL (
        SELECT generate_series(
          date_trunc('month', GREATEST(rs.data_inicio_faturamento, p_data_inicio))::date,
          date_trunc('month', p_data_fim)::date,
          interval '1 month'
        )::date AS ref_mes
      ) gs ON true
      CROSS JOIN LATERAL (
        SELECT (
          CASE
            WHEN rs.regra_cobranca = 'salario_minimo' THEN
              COALESCE(NULLIF(rs.cfg->>'quantidade_sm', '')::numeric, 0)
              * COALESCE(
                  (SELECT sm.valor FROM config.salario_minimo sm
                    WHERE sm.tenant_id = v_tenant_id AND sm.vigencia_desde <= gs.ref_mes
                    ORDER BY sm.vigencia_desde DESC LIMIT 1),
                  (SELECT sm.valor FROM config.salario_minimo sm
                    WHERE sm.tenant_id = v_tenant_id
                    ORDER BY sm.vigencia_desde DESC LIMIT 1),
                  0
                )
            ELSE COALESCE(NULLIF(rs.cfg->>'valor_mensal', '')::numeric, 0)
          END
        ) AS valor
      ) val
      WHERE rs.rule_status = 'ativo'
        AND rs.regra_cobranca IN ('mensal', 'mensalidade_processo', 'salario_minimo')
        AND val.valor > 0
        AND (
          date_trunc('month', gs.ref_mes) <> date_trunc('month', CURRENT_DATE)
          OR COALESCE(rs.dia_inicio_faturamento, EXTRACT(DAY FROM rs.data_inicio_faturamento)::integer, 1)
            <= EXTRACT(DAY FROM CURRENT_DATE)::integer
        )
    ),
    regra_projeto_parcelas AS (
      SELECT
        finance.rule_origin_uuid(rs.caso_id, rs.rule_id || ':parcela:' || p.ord::text) AS origem_id,
        rs.origem_regra_id,
        NULLIF(p.item->>'data_pagamento', '')::date AS data_referencia,
        0::numeric(12,2) AS horas,
        COALESCE(NULLIF(p.item->>'valor', '')::numeric, 0)::numeric(14,2) AS valor,
        rs.contrato_id,
        rs.contrato_numero,
        rs.contrato_numero_sequencial,
        rs.nome_contrato,
        rs.cliente_id,
        rs.cliente_nome,
        rs.caso_id,
        rs.caso_numero,
        rs.caso_nome,
        'projeto_parcela'::text AS item_tipo,
        ('Projeto - Parcela ' || p.ord::text)::text AS descricao,
        ''::text AS lancado_por
      FROM rules_source rs
      CROSS JOIN LATERAL jsonb_array_elements(rs.cfg->'parcelas') WITH ORDINALITY AS p(item, ord)
      WHERE rs.rule_status = 'ativo'
        AND rs.regra_cobranca IN ('projeto', 'pro_labore')
        AND jsonb_typeof(rs.cfg->'parcelas') = 'array'
        AND jsonb_array_length(rs.cfg->'parcelas') > 0
        AND NULLIF(p.item->>'data_pagamento', '')::date BETWEEN p_data_inicio AND p_data_fim
        AND COALESCE(NULLIF(p.item->>'valor', '')::numeric, 0) > 0
    ),
    regra_projeto_unico AS (
      SELECT
        finance.rule_origin_uuid(rs.caso_id, rs.rule_id || ':projeto_unico') AS origem_id,
        rs.origem_regra_id,
        rs.data_inicio_faturamento::date AS data_referencia,
        0::numeric(12,2) AS horas,
        COALESCE(NULLIF(rs.cfg->>'valor_projeto', '')::numeric, 0)::numeric(14,2) AS valor,
        rs.contrato_id,
        rs.contrato_numero,
        rs.contrato_numero_sequencial,
        rs.nome_contrato,
        rs.cliente_id,
        rs.cliente_nome,
        rs.caso_id,
        rs.caso_numero,
        rs.caso_nome,
        'projeto'::text AS item_tipo,
        'Projeto - Valor único'::text AS descricao,
        ''::text AS lancado_por
      FROM rules_source rs
      WHERE rs.rule_status = 'ativo'
        AND rs.regra_cobranca IN ('projeto', 'pro_labore')
        AND (
          jsonb_typeof(rs.cfg->'parcelas') <> 'array'
          OR jsonb_array_length(rs.cfg->'parcelas') = 0
        )
        AND rs.data_inicio_faturamento BETWEEN p_data_inicio AND p_data_fim
        AND COALESCE(NULLIF(rs.cfg->>'valor_projeto', '')::numeric, 0) > 0
    ),
    regra_exito AS (
      SELECT
        finance.rule_origin_uuid(rs.caso_id, rs.rule_id || ':exito') AS origem_id,
        rs.origem_regra_id,
        NULLIF(rs.cfg->>'data_pagamento_exito', '')::date AS data_referencia,
        0::numeric(12,2) AS horas,
        COALESCE(
          NULLIF(rs.cfg->>'valor_exito_calculado', '')::numeric,
          (
            COALESCE(NULLIF(rs.cfg->>'valor_acao', '')::numeric, 0)
            * COALESCE(NULLIF(rs.cfg->>'percentual_exito', '')::numeric, 0)
            / 100.0
          )
        )::numeric(14,2) AS valor,
        rs.contrato_id,
        rs.contrato_numero,
        rs.contrato_numero_sequencial,
        rs.nome_contrato,
        rs.cliente_id,
        rs.cliente_nome,
        rs.caso_id,
        rs.caso_numero,
        rs.caso_nome,
        'exito'::text AS item_tipo,
        'Êxito'::text AS descricao,
        ''::text AS lancado_por
      FROM rules_source rs
      WHERE rs.rule_status = 'ativo'
        AND rs.regra_cobranca = 'exito'
        AND NULLIF(rs.cfg->>'data_pagamento_exito', '')::date BETWEEN p_data_inicio AND p_data_fim
        AND COALESCE(
          NULLIF(rs.cfg->>'valor_exito_calculado', '')::numeric,
          (
            COALESCE(NULLIF(rs.cfg->>'valor_acao', '')::numeric, 0)
            * COALESCE(NULLIF(rs.cfg->>'percentual_exito', '')::numeric, 0)
            / 100.0
          )
        ) > 0
    ),
    regra_itens_raw AS (
      SELECT * FROM regra_mensal_itens
      UNION ALL
      SELECT * FROM regra_projeto_parcelas
      UNION ALL
      SELECT * FROM regra_projeto_unico
      UNION ALL
      SELECT * FROM regra_exito
    ),
    regra_itens AS (
      SELECT r.*
      FROM regra_itens_raw r
      WHERE NOT EXISTS (
        SELECT 1
        FROM finance.billing_items bi
        WHERE bi.tenant_id = v_tenant_id
          AND bi.origem_tipo = 'regra_financeira'
          AND bi.periodo_inicio = p_data_inicio
          AND bi.periodo_fim = p_data_fim
          AND bi.status <> 'cancelado'
          AND (bi.origem_id = r.origem_id OR bi.origem_id = r.origem_regra_id)
      )
    ),
    item_rows AS (
      SELECT
        bt.cliente_id,
        bt.cliente_nome,
        bt.contrato_id,
        bt.contrato_numero,
        bt.contrato_numero_sequencial,
        bt.nome_contrato,
        bt.caso_id,
        bt.caso_numero,
        bt.caso_nome,
        bt.origem_id,
        bt.data_referencia,
        bt.horas,
        bt.valor,
        bt.item_tipo,
        bt.caso_regra,
        bt.descricao,
        bt.lancado_por
      FROM base_timesheet bt
      UNION ALL
      SELECT
        ri.cliente_id,
        ri.cliente_nome,
        ri.contrato_id,
        ri.contrato_numero,
        ri.contrato_numero_sequencial,
        ri.nome_contrato,
        ri.caso_id,
        ri.caso_numero,
        ri.caso_nome,
        ri.origem_id,
        ri.data_referencia,
        ri.horas,
        ri.valor,
        ri.item_tipo,
        NULL::text AS caso_regra,
        ri.descricao,
        ri.lancado_por
      FROM regra_itens ri
    ),
    case_agg AS (
      SELECT
        cliente_id,
        cliente_nome,
        contrato_id,
        contrato_numero,
        contrato_numero_sequencial,
        nome_contrato,
        caso_id,
        caso_numero,
        caso_nome,
        COUNT(*)::bigint AS total_itens,
        COALESCE(SUM(horas), 0)::numeric(12,2) AS total_horas,
        COALESCE(SUM(valor), 0)::numeric(14,2) AS total_valor,
        COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'tipo', item_tipo,
              'caso_regra', caso_regra,
              'descricao', descricao,
              'lancado_por', lancado_por,
              'data_referencia', data_referencia,
              'horas', horas,
              'valor', valor
            )
            -- regra do caso primeiro (valor principal), horas embaixo p/ validação
            ORDER BY (item_tipo = 'timesheet'), data_referencia NULLS LAST, descricao
          ),
          '[]'::jsonb
        ) AS extrato
      FROM item_rows
      GROUP BY cliente_id, cliente_nome, contrato_id, contrato_numero, contrato_numero_sequencial, nome_contrato, caso_id, caso_numero, caso_nome
    ),
    contrato_agg AS (
      SELECT
        cliente_id,
        cliente_nome,
        contrato_id,
        contrato_numero,
        contrato_numero_sequencial,
        nome_contrato,
        COALESCE(SUM(total_horas), 0)::numeric(12,2) AS total_horas,
        COALESCE(SUM(total_valor), 0)::numeric(14,2) AS total_valor,
        COALESCE(SUM(total_itens), 0)::bigint AS total_itens,
        jsonb_agg(
          jsonb_build_object(
            'caso_id', caso_id,
            'caso_numero', caso_numero,
            'caso_nome', caso_nome,
            'total_horas', total_horas,
            'total_valor', total_valor,
            'total_itens', total_itens,
            'extrato', extrato
          )
          ORDER BY caso_numero NULLS LAST, caso_nome
        ) AS casos
      FROM case_agg
      GROUP BY cliente_id, cliente_nome, contrato_id, contrato_numero, contrato_numero_sequencial, nome_contrato
    ),
    cliente_agg AS (
      SELECT
        cliente_id,
        cliente_nome,
        COALESCE(SUM(total_horas), 0)::numeric(12,2) AS total_horas,
        COALESCE(SUM(total_valor), 0)::numeric(14,2) AS total_valor,
        COALESCE(SUM(total_itens), 0)::bigint AS total_itens,
        jsonb_agg(
          jsonb_build_object(
            'contrato_id', contrato_id,
            'contrato_numero', contrato_numero,
            'contrato_numero_sequencial', contrato_numero_sequencial,
            'contrato_nome', nome_contrato,
            'total_horas', total_horas,
            'total_valor', total_valor,
            'total_itens', total_itens,
            'casos', casos
          )
          ORDER BY contrato_numero NULLS LAST, nome_contrato
        ) AS contratos
      FROM contrato_agg
      GROUP BY cliente_id, cliente_nome
    )
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'cliente_id', cliente_id,
          'cliente_nome', cliente_nome,
          'total_horas', total_horas,
          'total_valor', total_valor,
          'total_itens', total_itens,
          'contratos', contratos
        )
        ORDER BY cliente_nome
      ),
      '[]'::jsonb
    )
    FROM cliente_agg
  );
END;
$function$;

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
  v_somente_regras boolean := false;
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
  v_somente_regras := COALESCE((p_payload->>'somente_regras')::boolean, false);
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

  -- Passo 7: barra hora sem preço antes de criar qualquer item.
  IF NOT v_somente_regras AND array_length(v_alvo_ids, 1) > 0 THEN
    PERFORM public.validar_precos_antes_de_liberar(v_tenant_id, v_alvo_ids);
  END IF;
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
      COALESCE(public.resolver_valor_hora(cs.id, t.cargo_id), 0) AS valor_hora,
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
        WHEN ers.regra_cobranca IN ('projeto', 'pro_labore') THEN
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
    WHERE ers.regra_cobranca IN ('mensal', 'mensalidade_processo', 'mensalidade_carteira', 'projeto', 'pro_labore', 'exito', 'salario_minimo')
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
    -- 'Gerar faturamento do mês' não arrasta horas: elas entram quando o
    -- financeiro envia (por caso/contrato) — call de 08/07.
    WHERE NOT v_somente_regras
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
    -- Gerar do mês é idempotente: se as regras do mês já foram geradas,
    -- responde ok (0 novos) em vez de erro — evita o "não consigo forçar".
    IF v_somente_regras THEN
      RETURN jsonb_build_object(
        'batch_id', NULL,
        'batch_numero', NULL,
        'itens_criados', 0,
        'mensagem', 'Todas as regras do período já estavam geradas — nenhum item novo.'
      );
    END IF;
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
$function$;

