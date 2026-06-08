-- Report Builder — entidade Colaboradores (daily Filipe 08/06).
--
-- Eduardo perguntou se dá pra gerar um relatório de base completa de
-- colaboradores nos Relatórios. Hoje a tela só oferece 5 entidades
-- (clientes, contratos, casos, billing_items, notas_geradas) — colaboradores
-- não estava na lista. Esta migration adiciona o branch 'colaboradores' ao
-- report_builder, reaproveitando todo o pipeline (preview + export CSV/Excel).
--
-- Escopo definido com o cliente: base COMPLETA, todos os campos visíveis sem
-- restrição de permissão (inclui salário, dados bancários, PIX, CPF).
--
-- ⚠️ CONFIRMAR NO PROD ANTES DO DEPLOY MANUAL (schema herdado, não está no repo):
--   1. people.colaboradores tem coluna tenant_id  (filtro multi-tenant)
--   2. people.cargos e people.areas existem com colunas id e nome
--      (FKs cargo_id / area_id confirmadas no colaborador-edit-form)
--   3. nomes das colunas escalares batem com a lista v_allowed_cols abaixo
--      (a maioria confirmada via colaborador-view: data_entrada, data_saida,
--       conta_com_digito, percentual_adicional, chave_pix, etc.)
--   Rodar:  \d people.colaboradores  /  \d people.cargos  /  \d people.areas
--   e ajustar a lista/joins se algo divergir.

CREATE OR REPLACE FUNCTION public.report_builder(
  p_user_id uuid,
  p_entity text,
  p_columns text[],
  p_filters jsonb DEFAULT '{}'::jsonb,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, contracts, crm, finance, people, operations
AS $function$
DECLARE
  v_tenant_id uuid;
  v_allowed_cols text[];
  v_select_cols text;
  v_from_clause text;
  v_where_clause text := '';
  v_col text;
  v_query text;
  v_count_query text;
  v_total bigint;
  v_rows jsonb;
  v_search text;
BEGIN
  SELECT tu.tenant_id INTO v_tenant_id
    FROM core.tenant_users tu
   WHERE tu.user_id = p_user_id AND tu.status = 'ativo'
   LIMIT 1;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não pertence a nenhum tenant';
  END IF;

  IF p_limit IS NULL OR p_limit < 1 THEN p_limit := 50; END IF;
  IF p_limit > 5000 THEN p_limit := 5000; END IF;
  IF p_offset IS NULL OR p_offset < 0 THEN p_offset := 0; END IF;

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
        'id','numero','numero_sequencial','nome_contrato','status','regime_fiscal',
        'forma_entrada','canal_prospeccao','created_at','updated_at',
        'cliente_id','cliente_nome','cliente_cnpj','cliente_tipo','cliente_email','cliente_telefone',
        'cliente_cidade','cliente_estado','cliente_regime_fiscal',
        'grupo_imposto_id','grupo_imposto_nome','total_casos',
        'responsavel_prospeccao_id','responsavel_prospeccao_nome',
        'servico_id','servico_nome','produto_id','produto_nome'
      ];
      v_from_clause := 'contracts.contratos ct '
        || 'LEFT JOIN crm.clientes cl ON cl.id = ct.cliente_id '
        || 'LEFT JOIN contracts.grupos_impostos gi ON gi.id = ct.grupo_imposto_id '
        || 'LEFT JOIN people.colaboradores rp ON rp.id = ct.responsavel_prospeccao_id '
        || 'LEFT JOIN operations.categorias_servico sv ON sv.id = ct.servico_id '
        || 'LEFT JOIN contracts.produtos pd ON pd.id = ct.produto_id '
        || 'LEFT JOIN LATERAL (SELECT count(*)::int AS cnt FROM contracts.casos cas WHERE cas.contrato_id = ct.id) cas_cnt ON true';
      v_where_clause := format('ct.tenant_id = %L', v_tenant_id);

    WHEN 'casos' THEN
      v_allowed_cols := ARRAY[
        'id','numero','nome','contrato_id','status','ativo','regra_cobranca',
        'responsavel_id','responsavel_nome','servico_id','servico_nome',
        'produto_id','produto_nome','polo','created_at',
        'contrato_numero_sequencial','contrato_nome','cliente_id','cliente_nome'
      ];
      v_from_clause := 'contracts.casos ca '
        || 'LEFT JOIN contracts.contratos ct2 ON ct2.id = ca.contrato_id '
        || 'LEFT JOIN crm.clientes cl2 ON cl2.id = ct2.cliente_id '
        || 'LEFT JOIN people.colaboradores resp ON resp.id = ca.responsavel_id '
        || 'LEFT JOIN operations.categorias_servico srv2 ON srv2.id = ca.servico_id '
        || 'LEFT JOIN contracts.produtos pd2 ON pd2.id = ca.produto_id';
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

    WHEN 'colaboradores' THEN
      v_allowed_cols := ARRAY[
        'id','nome','cpf','email','whatsapp','oab','categoria','ativo',
        'data_entrada','data_saida','data_nascimento',
        'cargo_nome','area_nome',
        'salario','adicional','percentual_adicional',
        'banco','agencia','conta_com_digito','chave_pix',
        'cep','rua','numero','complemento','cidade','estado'
      ];
      v_from_clause := 'people.colaboradores co '
        || 'LEFT JOIN people.cargos cg ON cg.id = co.cargo_id '
        || 'LEFT JOIN people.areas ar ON ar.id = co.area_id';
      v_where_clause := format('co.tenant_id = %L', v_tenant_id);

    ELSE
      RAISE EXCEPTION 'Entidade inválida: %', p_entity;
  END CASE;

  FOREACH v_col IN ARRAY p_columns LOOP
    IF NOT (v_col = ANY(v_allowed_cols)) THEN
      RAISE EXCEPTION 'Coluna inválida para %: %', p_entity, v_col;
    END IF;
  END LOOP;

  v_select_cols := '';
  FOREACH v_col IN ARRAY p_columns LOOP
    IF v_select_cols <> '' THEN v_select_cols := v_select_cols || ', '; END IF;
    CASE
      WHEN p_entity = 'contratos' AND v_col = 'cliente_nome' THEN
        v_select_cols := v_select_cols || 'cl.nome AS cliente_nome';
      WHEN p_entity = 'contratos' AND v_col = 'cliente_cnpj' THEN
        v_select_cols := v_select_cols || 'cl.cnpj AS cliente_cnpj';
      WHEN p_entity = 'contratos' AND v_col = 'cliente_tipo' THEN
        v_select_cols := v_select_cols || 'cl.tipo AS cliente_tipo';
      WHEN p_entity = 'contratos' AND v_col = 'cliente_email' THEN
        v_select_cols := v_select_cols || 'cl.email AS cliente_email';
      WHEN p_entity = 'contratos' AND v_col = 'cliente_telefone' THEN
        v_select_cols := v_select_cols || 'cl.telefone AS cliente_telefone';
      WHEN p_entity = 'contratos' AND v_col = 'cliente_cidade' THEN
        v_select_cols := v_select_cols || 'cl.cidade AS cliente_cidade';
      WHEN p_entity = 'contratos' AND v_col = 'cliente_estado' THEN
        v_select_cols := v_select_cols || 'cl.estado AS cliente_estado';
      WHEN p_entity = 'contratos' AND v_col = 'cliente_regime_fiscal' THEN
        v_select_cols := v_select_cols || 'cl.regime_fiscal AS cliente_regime_fiscal';
      WHEN p_entity = 'contratos' AND v_col = 'grupo_imposto_nome' THEN
        v_select_cols := v_select_cols || 'gi.nome AS grupo_imposto_nome';
      WHEN p_entity = 'contratos' AND v_col = 'total_casos' THEN
        v_select_cols := v_select_cols || 'cas_cnt.cnt AS total_casos';
      WHEN p_entity = 'contratos' AND v_col = 'responsavel_prospeccao_nome' THEN
        v_select_cols := v_select_cols || 'rp.nome AS responsavel_prospeccao_nome';
      WHEN p_entity = 'contratos' AND v_col = 'servico_nome' THEN
        v_select_cols := v_select_cols || 'sv.nome AS servico_nome';
      WHEN p_entity = 'contratos' AND v_col = 'produto_nome' THEN
        v_select_cols := v_select_cols || 'pd.nome AS produto_nome';

      WHEN p_entity = 'casos' AND v_col = 'contrato_numero_sequencial' THEN
        v_select_cols := v_select_cols || 'ct2.numero_sequencial AS contrato_numero_sequencial';
      WHEN p_entity = 'casos' AND v_col = 'contrato_nome' THEN
        v_select_cols := v_select_cols || 'ct2.nome_contrato AS contrato_nome';
      WHEN p_entity = 'casos' AND v_col = 'cliente_id' THEN
        v_select_cols := v_select_cols || 'cl2.id AS cliente_id';
      WHEN p_entity = 'casos' AND v_col = 'cliente_nome' THEN
        v_select_cols := v_select_cols || 'cl2.nome AS cliente_nome';
      WHEN p_entity = 'casos' AND v_col = 'responsavel_nome' THEN
        v_select_cols := v_select_cols || 'resp.nome AS responsavel_nome';
      WHEN p_entity = 'casos' AND v_col = 'servico_nome' THEN
        v_select_cols := v_select_cols || 'srv2.nome AS servico_nome';
      WHEN p_entity = 'casos' AND v_col = 'produto_nome' THEN
        v_select_cols := v_select_cols || 'pd2.nome AS produto_nome';

      WHEN p_entity = 'billing_items' AND v_col = 'contrato_nome' THEN
        v_select_cols := v_select_cols || 'ct3.nome_contrato AS contrato_nome';
      WHEN p_entity = 'billing_items' AND v_col = 'cliente_nome' THEN
        v_select_cols := v_select_cols || 'cl3.nome AS cliente_nome';

      WHEN p_entity = 'notas_geradas' AND v_col = 'contrato_nome' THEN
        v_select_cols := v_select_cols || 'ct4.nome_contrato AS contrato_nome';
      WHEN p_entity = 'notas_geradas' AND v_col = 'caso_nome' THEN
        v_select_cols := v_select_cols || 'ca2.nome AS caso_nome';

      WHEN p_entity = 'colaboradores' AND v_col = 'cargo_nome' THEN
        v_select_cols := v_select_cols || 'cg.nome AS cargo_nome';
      WHEN p_entity = 'colaboradores' AND v_col = 'area_nome' THEN
        v_select_cols := v_select_cols || 'ar.nome AS area_nome';

      ELSE
        CASE p_entity
          WHEN 'clientes' THEN v_select_cols := v_select_cols || 'c.' || v_col;
          WHEN 'contratos' THEN v_select_cols := v_select_cols || 'ct.' || v_col;
          WHEN 'casos' THEN v_select_cols := v_select_cols || 'ca.' || v_col;
          WHEN 'billing_items' THEN v_select_cols := v_select_cols || 'bi.' || v_col;
          WHEN 'notas_geradas' THEN v_select_cols := v_select_cols || 'bn.' || v_col;
          WHEN 'colaboradores' THEN v_select_cols := v_select_cols || 'co.' || v_col;
        END CASE;
    END CASE;
  END LOOP;

  -- Filtro status (mantém compat)
  IF p_filters ? 'status' AND (p_filters->>'status') <> '' THEN
    CASE p_entity
      WHEN 'clientes' THEN
        IF (p_filters->>'status') = 'ativo' THEN
          v_where_clause := v_where_clause || ' AND c.ativo = true';
        ELSIF (p_filters->>'status') = 'inativo' THEN
          v_where_clause := v_where_clause || ' AND c.ativo = false';
        END IF;
      WHEN 'colaboradores' THEN
        IF (p_filters->>'status') = 'ativo' THEN
          v_where_clause := v_where_clause || ' AND co.ativo = true';
        ELSIF (p_filters->>'status') = 'inativo' THEN
          v_where_clause := v_where_clause || ' AND co.ativo = false';
        END IF;
      WHEN 'contratos' THEN v_where_clause := v_where_clause || format(' AND ct.status = %L', p_filters->>'status');
      WHEN 'casos' THEN v_where_clause := v_where_clause || format(' AND ca.status = %L', p_filters->>'status');
      WHEN 'billing_items' THEN v_where_clause := v_where_clause || format(' AND bi.status = %L', p_filters->>'status');
      WHEN 'notas_geradas' THEN v_where_clause := v_where_clause || format(' AND bn.status = %L', p_filters->>'status');
    END CASE;
  END IF;

  -- Filtros de data
  IF p_filters ? 'date_from' AND (p_filters->>'date_from') <> '' THEN
    CASE p_entity
      WHEN 'clientes' THEN v_where_clause := v_where_clause || format(' AND c.created_at >= %L::timestamptz', p_filters->>'date_from');
      WHEN 'contratos' THEN v_where_clause := v_where_clause || format(' AND ct.created_at >= %L::timestamptz', p_filters->>'date_from');
      WHEN 'casos' THEN v_where_clause := v_where_clause || format(' AND ca.created_at >= %L::timestamptz', p_filters->>'date_from');
      WHEN 'billing_items' THEN v_where_clause := v_where_clause || format(' AND bi.created_at >= %L::timestamptz', p_filters->>'date_from');
      WHEN 'notas_geradas' THEN v_where_clause := v_where_clause || format(' AND bn.created_at >= %L::timestamptz', p_filters->>'date_from');
      WHEN 'colaboradores' THEN v_where_clause := v_where_clause || format(' AND co.data_entrada >= %L::date', p_filters->>'date_from');
    END CASE;
  END IF;
  IF p_filters ? 'date_to' AND (p_filters->>'date_to') <> '' THEN
    CASE p_entity
      WHEN 'clientes' THEN v_where_clause := v_where_clause || format(' AND c.created_at <= (%L::date + 1)::timestamptz', p_filters->>'date_to');
      WHEN 'contratos' THEN v_where_clause := v_where_clause || format(' AND ct.created_at <= (%L::date + 1)::timestamptz', p_filters->>'date_to');
      WHEN 'casos' THEN v_where_clause := v_where_clause || format(' AND ca.created_at <= (%L::date + 1)::timestamptz', p_filters->>'date_to');
      WHEN 'billing_items' THEN v_where_clause := v_where_clause || format(' AND bi.created_at <= (%L::date + 1)::timestamptz', p_filters->>'date_to');
      WHEN 'notas_geradas' THEN v_where_clause := v_where_clause || format(' AND bn.created_at <= (%L::date + 1)::timestamptz', p_filters->>'date_to');
      WHEN 'colaboradores' THEN v_where_clause := v_where_clause || format(' AND co.data_entrada <= %L::date', p_filters->>'date_to');
    END CASE;
  END IF;

  -- Filtro cliente_id (contratos, casos, billing_items)
  IF p_filters ? 'cliente_id' AND (p_filters->>'cliente_id') <> '' THEN
    CASE p_entity
      WHEN 'contratos' THEN v_where_clause := v_where_clause || format(' AND ct.cliente_id = %L', (p_filters->>'cliente_id')::uuid);
      WHEN 'casos' THEN v_where_clause := v_where_clause || format(' AND ct2.cliente_id = %L', (p_filters->>'cliente_id')::uuid);
      WHEN 'billing_items' THEN v_where_clause := v_where_clause || format(' AND ct3.cliente_id = %L', (p_filters->>'cliente_id')::uuid);
      ELSE NULL;
    END CASE;
  END IF;

  -- Filtro responsavel_id (casos)
  IF p_filters ? 'responsavel_id' AND (p_filters->>'responsavel_id') <> '' THEN
    IF p_entity = 'casos' THEN
      v_where_clause := v_where_clause || format(' AND ca.responsavel_id = %L', (p_filters->>'responsavel_id')::uuid);
    END IF;
  END IF;

  -- Filtro regime_fiscal (contratos, clientes)
  IF p_filters ? 'regime_fiscal' AND (p_filters->>'regime_fiscal') <> '' THEN
    CASE p_entity
      WHEN 'contratos' THEN v_where_clause := v_where_clause || format(' AND ct.regime_fiscal = %L', p_filters->>'regime_fiscal');
      WHEN 'clientes' THEN v_where_clause := v_where_clause || format(' AND c.regime_fiscal = %L', p_filters->>'regime_fiscal');
      ELSE NULL;
    END CASE;
  END IF;

  -- Busca textual livre (ILIKE em campos texto principais)
  IF p_filters ? 'search' AND (p_filters->>'search') <> '' THEN
    v_search := '%' || (p_filters->>'search') || '%';
    CASE p_entity
      WHEN 'clientes' THEN
        v_where_clause := v_where_clause || format(' AND (c.nome ILIKE %L OR c.cnpj ILIKE %L OR c.email ILIKE %L OR c.cidade ILIKE %L)', v_search, v_search, v_search, v_search);
      WHEN 'contratos' THEN
        v_where_clause := v_where_clause || format(' AND (ct.nome_contrato ILIKE %L OR ct.numero_sequencial::text ILIKE %L OR cl.nome ILIKE %L OR cl.cnpj ILIKE %L)', v_search, v_search, v_search, v_search);
      WHEN 'casos' THEN
        v_where_clause := v_where_clause || format(' AND (ca.nome ILIKE %L OR ca.numero::text ILIKE %L OR ct2.nome_contrato ILIKE %L OR cl2.nome ILIKE %L)', v_search, v_search, v_search, v_search);
      WHEN 'billing_items' THEN
        v_where_clause := v_where_clause || format(' AND (ct3.nome_contrato ILIKE %L OR cl3.nome ILIKE %L)', v_search, v_search);
      WHEN 'notas_geradas' THEN
        v_where_clause := v_where_clause || format(' AND (bn.numero::text ILIKE %L OR ct4.nome_contrato ILIKE %L OR ca2.nome ILIKE %L)', v_search, v_search, v_search);
      WHEN 'colaboradores' THEN
        v_where_clause := v_where_clause || format(' AND (co.nome ILIKE %L OR co.cpf ILIKE %L OR co.email ILIKE %L OR co.whatsapp ILIKE %L OR cg.nome ILIKE %L)', v_search, v_search, v_search, v_search, v_search);
    END CASE;
  END IF;

  v_count_query := format('SELECT count(*) FROM %s WHERE %s', v_from_clause, v_where_clause);
  EXECUTE v_count_query INTO v_total;

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
$function$;

GRANT EXECUTE ON FUNCTION public.report_builder(uuid, text, text[], jsonb, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.report_builder(uuid, text, text[], jsonb, integer, integer) TO service_role;

NOTIFY pgrst, 'reload schema';
