-- Item 2 daily 2026-05-07: uniformizar exibição "Contrato N" em listagens.
-- get_solicitacoes_contrato, get_itens_a_faturar e get_despesas passam a
-- retornar contrato_numero_sequencial (RF-064 canonical) ao lado do legacy
-- contrato_numero (bigint). Frontend prefere numero_sequencial via
-- formatContratoDisplay quando presente, fallback para numero.
--
-- Inclui as features do Item 7 (lido_at + p_only_unread em
-- get_solicitacoes_contrato) para tolerar ordem de merge fora de sequência.

DROP FUNCTION IF EXISTS public.get_solicitacoes_contrato(uuid);
DROP FUNCTION IF EXISTS public.get_solicitacoes_contrato(uuid, boolean);

CREATE OR REPLACE FUNCTION public.get_solicitacoes_contrato(
  p_user_id uuid,
  p_only_unread boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tenant_id uuid;
  v_is_manager boolean;
BEGIN
  SELECT tenant_id INTO v_tenant_id
  FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id AND tu.status = 'ativo'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Usuario nao associado a tenant';
  END IF;

  v_is_manager := public.is_admin_or_socio(p_user_id, v_tenant_id);

  RETURN COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', s.id,
        'descricao', s.descricao,
        'status', s.status,
        'cliente_id', COALESCE(s.cliente_id, c.cliente_id),
        'cliente_nome', COALESCE(cli.nome, cli_contrato.nome),
        'contrato_id', s.contrato_id,
        'contrato_numero', c.numero,
        'contrato_numero_sequencial', c.numero_sequencial,
        'contrato_nome', c.nome_contrato,
        'solicitante_user_id', s.solicitante_user_id,
        'solicitante_nome', col.nome,
        'concluida_em', s.concluida_em,
        'lido_at', s.lido_at,
        'created_at', s.created_at,
        'anexos', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id', a.id,
            'nome', a.nome,
            'arquivo_nome', a.arquivo_nome,
            'mime_type', a.mime_type,
            'tamanho_bytes', a.tamanho_bytes,
            'created_at', a.created_at
          ) ORDER BY a.created_at DESC)
          FROM contracts.solicitacoes_contrato_anexos a
          WHERE a.solicitacao_id = s.id
        ), '[]'::jsonb)
      )
      ORDER BY s.created_at DESC
    )
    FROM contracts.solicitacoes_contrato s
    LEFT JOIN contracts.contratos c ON c.id = s.contrato_id AND c.tenant_id = s.tenant_id
    LEFT JOIN crm.clientes cli ON cli.id = s.cliente_id AND cli.tenant_id = s.tenant_id
    LEFT JOIN crm.clientes cli_contrato ON cli_contrato.id = c.cliente_id AND cli_contrato.tenant_id = s.tenant_id
    LEFT JOIN people.colaboradores col ON col.user_id = s.solicitante_user_id AND col.tenant_id = s.tenant_id
    WHERE s.tenant_id = v_tenant_id
      AND (v_is_manager OR s.solicitante_user_id = p_user_id)
      AND (NOT p_only_unread OR s.lido_at IS NULL)
  ), '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_solicitacoes_contrato(uuid, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_despesas(p_user_id uuid, p_filters jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tenant_id uuid;
BEGIN
  SELECT tenant_id INTO v_tenant_id
  FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id AND tu.status = 'ativo'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Usuario nao associado a tenant';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', d.id,
        'contrato_id', d.contrato_id,
        'contrato_numero', ct.numero,
        'contrato_numero_sequencial', ct.numero_sequencial,
        'contrato_nome', ct.nome_contrato,
        'caso_id', d.caso_id,
        'caso_numero', cs.numero,
        'caso_nome', cs.nome,
        'cliente_id', ct.cliente_id,
        'cliente_nome', cli.nome,
        'data_lancamento', d.data_lancamento,
        'categoria', d.categoria,
        'valor', COALESCE(d.valor, 0),
        'descricao', d.descricao,
        'status', d.status,
        'arquivo_nome', d.arquivo_nome,
        'mime_type', d.mime_type,
        'tamanho_bytes', d.tamanho_bytes,
        'created_by', d.created_by,
        'created_by_nome', cb.nome,
        'created_at', d.created_at,
        'updated_at', d.updated_at
      )
      ORDER BY d.data_lancamento DESC, d.created_at DESC
    )
    FROM operations.despesas d
    JOIN contracts.contratos ct ON ct.id = d.contrato_id
    JOIN contracts.casos cs ON cs.id = d.caso_id
    JOIN crm.clientes cli ON cli.id = ct.cliente_id
    LEFT JOIN people.colaboradores cb ON cb.user_id = d.created_by AND cb.tenant_id = d.tenant_id
    WHERE d.tenant_id = v_tenant_id
      AND (NULLIF(p_filters->>'contrato_id', '') IS NULL OR d.contrato_id = (p_filters->>'contrato_id')::uuid)
      AND (NULLIF(p_filters->>'caso_id', '') IS NULL OR d.caso_id = (p_filters->>'caso_id')::uuid)
      AND (NULLIF(p_filters->>'status', '') IS NULL OR d.status = p_filters->>'status')
      AND (NULLIF(p_filters->>'categoria', '') IS NULL OR lower(d.categoria) = lower(p_filters->>'categoria'))
      AND (NULLIF(p_filters->>'data_inicio', '') IS NULL OR d.data_lancamento >= (p_filters->>'data_inicio')::date)
      AND (NULLIF(p_filters->>'data_fim', '') IS NULL OR d.data_lancamento <= (p_filters->>'data_fim')::date)
  ), '[]'::jsonb);
END;
$$;

-- get_itens_a_faturar: 200+ linhas. Adiciona contrato_numero_sequencial nos
-- 4 callsites de jsonb_build_object (base_timesheet, regra_mensal_itens,
-- regra_projeto_parcelas, regra_projeto_unico, regra_exito) e na agregação
-- contrato_agg/case_agg/cliente_agg. Reescreve a função inteira preservando
-- toda lógica existente.

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
          * COALESCE(
              NULLIF(
                CASE
                  WHEN jsonb_typeof(cs.regras_financeiras) = 'array' AND jsonb_array_length(cs.regras_financeiras) > 0
                    THEN cs.regras_financeiras->0->'regra_cobranca_config'->>'valor_hora'
                  ELSE cs.regra_cobranca_config->>'valor_hora'
                END,
                ''
              )::numeric,
              0
            )
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
        ('Timesheet - ' || to_char(t.data_lancamento::date, 'DD/MM/YYYY'))::text AS descricao
      FROM operations.timesheets t
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
        COALESCE(NULLIF(rs.cfg->>'valor_mensal', '')::numeric, 0)::numeric(14,2) AS valor,
        rs.contrato_id,
        rs.contrato_numero,
        rs.contrato_numero_sequencial,
        rs.nome_contrato,
        rs.cliente_id,
        rs.cliente_nome,
        rs.caso_id,
        rs.caso_numero,
        rs.caso_nome,
        rs.regra_cobranca AS item_tipo,
        (
          CASE
            WHEN rs.regra_cobranca = 'mensalidade_processo' THEN 'Mensalidade de processo'
            ELSE 'Mensalidade'
          END
          || ' - ' || to_char(gs.ref_mes, 'MM/YYYY')
        )::text AS descricao
      FROM rules_source rs
      JOIN LATERAL (
        SELECT generate_series(
          date_trunc('month', GREATEST(rs.data_inicio_faturamento, p_data_inicio))::date,
          date_trunc('month', p_data_fim)::date,
          interval '1 month'
        )::date AS ref_mes
      ) gs ON true
      WHERE rs.rule_status = 'ativo'
        AND rs.regra_cobranca IN ('mensal', 'mensalidade_processo')
        AND COALESCE(NULLIF(rs.cfg->>'valor_mensal', '')::numeric, 0) > 0
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
        ('Projeto - Parcela ' || p.ord::text)::text AS descricao
      FROM rules_source rs
      CROSS JOIN LATERAL jsonb_array_elements(rs.cfg->'parcelas') WITH ORDINALITY AS p(item, ord)
      WHERE rs.rule_status = 'ativo'
        AND rs.regra_cobranca = 'projeto'
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
        'Projeto - Valor único'::text AS descricao
      FROM rules_source rs
      WHERE rs.rule_status = 'ativo'
        AND rs.regra_cobranca = 'projeto'
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
        'Êxito'::text AS descricao
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
        bt.descricao
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
        ri.descricao
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
              'descricao', descricao,
              'data_referencia', data_referencia,
              'horas', horas,
              'valor', valor
            )
            ORDER BY data_referencia NULLS LAST, descricao
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
