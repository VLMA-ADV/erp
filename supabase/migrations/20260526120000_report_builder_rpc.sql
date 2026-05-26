-- Report Builder RPC: dynamic query por entidade com validação de colunas
-- Retorna dados + metadata para o módulo de relatórios personalizados

CREATE OR REPLACE FUNCTION public.report_builder(
  p_user_id uuid,
  p_entity  text,
  p_columns text[],
  p_filters jsonb DEFAULT '{}'::jsonb,
  p_limit   int   DEFAULT 50,
  p_offset  int   DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_allowed_cols text[];
  v_select_cols  text;
  v_from_clause  text;
  v_where_clause text := '';
  v_col          text;
  v_query        text;
  v_count_query  text;
  v_result       jsonb;
  v_total        bigint;
  v_rows         jsonb;
BEGIN
  -- Resolve tenant
  SELECT tu.tenant_id INTO v_tenant_id
    FROM core.tenant_users tu
   WHERE tu.user_id = p_user_id
   LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não pertence a nenhum tenant';
  END IF;

  -- Clamp limit
  IF p_limit IS NULL OR p_limit < 1 THEN p_limit := 50; END IF;
  IF p_limit > 5000 THEN p_limit := 5000; END IF;
  IF p_offset IS NULL OR p_offset < 0 THEN p_offset := 0; END IF;

  -- Define allowed columns + FROM clause per entity
  CASE p_entity
    WHEN 'clientes' THEN
      v_allowed_cols := ARRAY[
        'id','nome','cnpj','tipo','cliente_estrangeiro',
        'cep','rua','numero','complemento','bairro','cidade','estado','codigo_ibge',
        'email','telefone','regime_fiscal','ativo','created_at'
      ];
      v_from_clause := 'crm.clientes c';
      v_where_clause := format('c.tenant_id = %L', v_tenant_id);

    WHEN 'contratos' THEN
      v_allowed_cols := ARRAY[
        'id','numero_sequencial','nome_contrato','status','regime_fiscal',
        'forma_entrada','created_at','created_by',
        'cliente_nome','cliente_cnpj','cliente_tipo',
        'grupo_imposto_nome','total_casos'
      ];
      v_from_clause := 'contracts.contratos ct '
        || 'LEFT JOIN crm.clientes cl ON cl.id = ct.cliente_id '
        || 'LEFT JOIN finance.grupos_impostos gi ON gi.id = ct.grupo_imposto_id '
        || 'LEFT JOIN LATERAL (SELECT count(*)::int AS cnt FROM contracts.casos cas WHERE cas.contrato_id = ct.id) cas_cnt ON true';
      v_where_clause := format('ct.tenant_id = %L', v_tenant_id);

    WHEN 'casos' THEN
      v_allowed_cols := ARRAY[
        'id','numero','nome','contrato_id','status','created_at',
        'contrato_numero_sequencial','contrato_nome','cliente_nome'
      ];
      v_from_clause := 'contracts.casos ca '
        || 'LEFT JOIN contracts.contratos ct2 ON ct2.id = ca.contrato_id '
        || 'LEFT JOIN crm.clientes cl2 ON cl2.id = ct2.cliente_id';
      v_where_clause := format('ca.tenant_id = %L', v_tenant_id);

    WHEN 'billing_items' THEN
      v_allowed_cols := ARRAY[
        'id','contrato_id','caso_id','status','valor_aprovado','valor_revisado','created_at',
        'contrato_nome','cliente_nome'
      ];
      v_from_clause := 'finance.billing_items bi '
        || 'LEFT JOIN contracts.contratos ct3 ON ct3.id = bi.contrato_id '
        || 'LEFT JOIN crm.clientes cl3 ON cl3.id = ct3.cliente_id';
      v_where_clause := format('bi.tenant_id = %L', v_tenant_id);

    WHEN 'notas_geradas' THEN
      v_allowed_cols := ARRAY[
        'id','numero','status','tipo_documento','focus_ref','focus_status','created_at',
        'contrato_nome','caso_nome'
      ];
      v_from_clause := 'finance.billing_notes bn '
        || 'LEFT JOIN contracts.contratos ct4 ON ct4.id = bn.contrato_id '
        || 'LEFT JOIN contracts.casos ca2 ON ca2.id = bn.caso_id';
      v_where_clause := format('bn.tenant_id = %L', v_tenant_id);

    ELSE
      RAISE EXCEPTION 'Entidade inválida: %', p_entity;
  END CASE;

  -- Validate requested columns
  FOREACH v_col IN ARRAY p_columns LOOP
    IF NOT (v_col = ANY(v_allowed_cols)) THEN
      RAISE EXCEPTION 'Coluna inválida para %: %', p_entity, v_col;
    END IF;
  END LOOP;

  -- Build SELECT expressions (map virtual columns to real expressions)
  v_select_cols := '';
  FOREACH v_col IN ARRAY p_columns LOOP
    IF v_select_cols <> '' THEN v_select_cols := v_select_cols || ', '; END IF;

    CASE
      -- Contratos virtual columns
      WHEN p_entity = 'contratos' AND v_col = 'cliente_nome' THEN
        v_select_cols := v_select_cols || 'cl.nome AS cliente_nome';
      WHEN p_entity = 'contratos' AND v_col = 'cliente_cnpj' THEN
        v_select_cols := v_select_cols || 'cl.cnpj AS cliente_cnpj';
      WHEN p_entity = 'contratos' AND v_col = 'cliente_tipo' THEN
        v_select_cols := v_select_cols || 'cl.tipo AS cliente_tipo';
      WHEN p_entity = 'contratos' AND v_col = 'grupo_imposto_nome' THEN
        v_select_cols := v_select_cols || 'gi.nome AS grupo_imposto_nome';
      WHEN p_entity = 'contratos' AND v_col = 'total_casos' THEN
        v_select_cols := v_select_cols || 'cas_cnt.cnt AS total_casos';
      -- Casos virtual columns
      WHEN p_entity = 'casos' AND v_col = 'contrato_numero_sequencial' THEN
        v_select_cols := v_select_cols || 'ct2.numero_sequencial AS contrato_numero_sequencial';
      WHEN p_entity = 'casos' AND v_col = 'contrato_nome' THEN
        v_select_cols := v_select_cols || 'ct2.nome_contrato AS contrato_nome';
      WHEN p_entity = 'casos' AND v_col = 'cliente_nome' THEN
        v_select_cols := v_select_cols || 'cl2.nome AS cliente_nome';
      -- Billing items virtual columns
      WHEN p_entity = 'billing_items' AND v_col = 'contrato_nome' THEN
        v_select_cols := v_select_cols || 'ct3.nome_contrato AS contrato_nome';
      WHEN p_entity = 'billing_items' AND v_col = 'cliente_nome' THEN
        v_select_cols := v_select_cols || 'cl3.nome AS cliente_nome';
      -- Notas geradas virtual columns
      WHEN p_entity = 'notas_geradas' AND v_col = 'contrato_nome' THEN
        v_select_cols := v_select_cols || 'ct4.nome_contrato AS contrato_nome';
      WHEN p_entity = 'notas_geradas' AND v_col = 'caso_nome' THEN
        v_select_cols := v_select_cols || 'ca2.nome AS caso_nome';
      ELSE
        -- Direct column from main table
        CASE p_entity
          WHEN 'clientes' THEN v_select_cols := v_select_cols || 'c.' || v_col;
          WHEN 'contratos' THEN v_select_cols := v_select_cols || 'ct.' || v_col;
          WHEN 'casos' THEN v_select_cols := v_select_cols || 'ca.' || v_col;
          WHEN 'billing_items' THEN v_select_cols := v_select_cols || 'bi.' || v_col;
          WHEN 'notas_geradas' THEN v_select_cols := v_select_cols || 'bn.' || v_col;
        END CASE;
    END CASE;
  END LOOP;

  -- Apply optional filters
  IF p_filters ? 'status' AND (p_filters->>'status') <> '' THEN
    CASE p_entity
      WHEN 'clientes' THEN
        IF (p_filters->>'status') = 'ativo' THEN
          v_where_clause := v_where_clause || ' AND c.ativo = true';
        ELSIF (p_filters->>'status') = 'inativo' THEN
          v_where_clause := v_where_clause || ' AND c.ativo = false';
        END IF;
      WHEN 'contratos' THEN
        v_where_clause := v_where_clause || format(' AND ct.status = %L', p_filters->>'status');
      WHEN 'casos' THEN
        v_where_clause := v_where_clause || format(' AND ca.status = %L', p_filters->>'status');
      WHEN 'billing_items' THEN
        v_where_clause := v_where_clause || format(' AND bi.status = %L', p_filters->>'status');
      WHEN 'notas_geradas' THEN
        v_where_clause := v_where_clause || format(' AND bn.status = %L', p_filters->>'status');
    END CASE;
  END IF;

  IF p_filters ? 'date_from' AND (p_filters->>'date_from') <> '' THEN
    CASE p_entity
      WHEN 'clientes' THEN
        v_where_clause := v_where_clause || format(' AND c.created_at >= %L::timestamptz', p_filters->>'date_from');
      WHEN 'contratos' THEN
        v_where_clause := v_where_clause || format(' AND ct.created_at >= %L::timestamptz', p_filters->>'date_from');
      WHEN 'casos' THEN
        v_where_clause := v_where_clause || format(' AND ca.created_at >= %L::timestamptz', p_filters->>'date_from');
      WHEN 'billing_items' THEN
        v_where_clause := v_where_clause || format(' AND bi.created_at >= %L::timestamptz', p_filters->>'date_from');
      WHEN 'notas_geradas' THEN
        v_where_clause := v_where_clause || format(' AND bn.created_at >= %L::timestamptz', p_filters->>'date_from');
    END CASE;
  END IF;

  IF p_filters ? 'date_to' AND (p_filters->>'date_to') <> '' THEN
    CASE p_entity
      WHEN 'clientes' THEN
        v_where_clause := v_where_clause || format(' AND c.created_at <= (%L::date + 1)::timestamptz', p_filters->>'date_to');
      WHEN 'contratos' THEN
        v_where_clause := v_where_clause || format(' AND ct.created_at <= (%L::date + 1)::timestamptz', p_filters->>'date_to');
      WHEN 'casos' THEN
        v_where_clause := v_where_clause || format(' AND ca.created_at <= (%L::date + 1)::timestamptz', p_filters->>'date_to');
      WHEN 'billing_items' THEN
        v_where_clause := v_where_clause || format(' AND bi.created_at <= (%L::date + 1)::timestamptz', p_filters->>'date_to');
      WHEN 'notas_geradas' THEN
        v_where_clause := v_where_clause || format(' AND bn.created_at <= (%L::date + 1)::timestamptz', p_filters->>'date_to');
    END CASE;
  END IF;

  -- Build count query
  v_count_query := format('SELECT count(*) FROM %s WHERE %s', v_from_clause, v_where_clause);
  EXECUTE v_count_query INTO v_total;

  -- Build data query
  v_query := format(
    'SELECT jsonb_agg(row_to_json(sub)) FROM (SELECT %s FROM %s WHERE %s ORDER BY 1 DESC LIMIT %s OFFSET %s) sub',
    v_select_cols, v_from_clause, v_where_clause, p_limit, p_offset
  );
  EXECUTE v_query INTO v_rows;

  RETURN jsonb_build_object(
    'data',    COALESCE(v_rows, '[]'::jsonb),
    'total',   v_total,
    'limit',   p_limit,
    'offset',  p_offset,
    'entity',  p_entity,
    'columns', to_jsonb(p_columns)
  );
END;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.report_builder(uuid, text, text[], jsonb, int, int) TO authenticated;
