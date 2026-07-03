-- Despesas: campo 'não reembolsável'. Reembolsável=true por padrão; não-reembolsável fica FORA do faturamento ao cliente.
ALTER TABLE operations.despesas ADD COLUMN IF NOT EXISTS reembolsavel boolean NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION public.create_despesa(p_user_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_tenant_id uuid;
  v_id uuid;
  v_contrato_id uuid;
  v_caso_id uuid;
  v_cliente_id uuid;
  v_valor numeric(14,2);
BEGIN
  SELECT tenant_id INTO v_tenant_id
  FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id AND tu.status = 'ativo'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não associado a tenant';
  END IF;

  IF NULLIF(p_payload->>'contrato_id', '') IS NULL OR NULLIF(p_payload->>'caso_id', '') IS NULL THEN
    RAISE EXCEPTION 'Contrato e caso são obrigatórios';
  END IF;

  IF COALESCE(NULLIF(trim(p_payload->>'categoria'), ''), '') = '' THEN
    RAISE EXCEPTION 'Categoria é obrigatória';
  END IF;

  IF COALESCE(NULLIF(trim(p_payload->>'arquivo_nome'), ''), '') = '' THEN
    RAISE EXCEPTION 'Arquivo é obrigatório';
  END IF;

  IF COALESCE(NULLIF(trim(p_payload->>'arquivo_base64'), ''), '') = '' THEN
    RAISE EXCEPTION 'Arquivo em base64 é obrigatório';
  END IF;

  v_valor := COALESCE(NULLIF(replace(p_payload->>'valor', ',', '.'), '')::numeric, 0);
  IF v_valor <= 0 THEN
    RAISE EXCEPTION 'Valor da despesa é obrigatório e deve ser maior que zero';
  END IF;

  v_contrato_id := (p_payload->>'contrato_id')::uuid;
  v_caso_id := (p_payload->>'caso_id')::uuid;

  SELECT c.cliente_id INTO v_cliente_id
  FROM contracts.contratos c
  WHERE c.id = v_contrato_id AND c.tenant_id = v_tenant_id AND c.status = 'ativo';

  IF v_cliente_id IS NULL THEN
    RAISE EXCEPTION 'Contrato não encontrado ou encerrado';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM contracts.casos cs
    WHERE cs.id = v_caso_id AND cs.contrato_id = v_contrato_id
      AND cs.tenant_id = v_tenant_id AND cs.status = 'ativo'
  ) THEN
    RAISE EXCEPTION 'Caso não encontrado/ativo para o contrato informado';
  END IF;

  INSERT INTO operations.despesas (
    tenant_id, cliente_id, contrato_id, caso_id, data_lancamento, categoria,
    valor, descricao, status, arquivo_nome, mime_type, tamanho_bytes, arquivo,
    reembolsavel, created_by, updated_by
  ) VALUES (
    v_tenant_id, v_cliente_id, v_contrato_id, v_caso_id,
    COALESCE(NULLIF(p_payload->>'data_lancamento', '')::date, now()::date),
    trim(p_payload->>'categoria'),
    v_valor,
    COALESCE(p_payload->>'descricao', ''),
    'em_lancamento',
    trim(p_payload->>'arquivo_nome'),
    NULLIF(p_payload->>'mime_type', ''),
    NULLIF(p_payload->>'tamanho_bytes', '')::bigint,
    decode(p_payload->>'arquivo_base64', 'base64'),
    COALESCE((p_payload->>'reembolsavel')::boolean, true),
    p_user_id, p_user_id
  ) RETURNING id INTO v_id;

  -- Anexos adicionais (opcionais)
  IF jsonb_typeof(p_payload->'anexos_extra') = 'array' THEN
    INSERT INTO operations.despesa_anexos (tenant_id, despesa_id, arquivo, arquivo_nome, mime_type, tamanho_bytes)
    SELECT v_tenant_id, v_id,
      decode(e->>'arquivo_base64', 'base64'),
      trim(e->>'arquivo_nome'),
      NULLIF(e->>'mime_type', ''),
      NULLIF(e->>'tamanho_bytes', '')::bigint
    FROM jsonb_array_elements(p_payload->'anexos_extra') e
    WHERE COALESCE(NULLIF(trim(e->>'arquivo_base64'), ''), '') <> ''
      AND COALESCE(NULLIF(trim(e->>'arquivo_nome'), ''), '') <> '';
  END IF;

  RETURN jsonb_build_object('id', v_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_despesa(p_user_id uuid, p_despesa_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_tenant_id uuid;
  v_current operations.despesas%ROWTYPE;
  v_is_admin boolean := false;
  v_valor numeric(14,2);
BEGIN
  SELECT tenant_id INTO v_tenant_id
  FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id AND tu.status = 'ativo'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não associado a tenant';
  END IF;

  SELECT * INTO v_current
  FROM operations.despesas d
  WHERE d.id = p_despesa_id AND d.tenant_id = v_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Despesa não encontrada';
  END IF;

  IF v_current.status = 'aprovado' THEN
    RAISE EXCEPTION 'Despesa aprovada não pode ser alterada';
  END IF;

  v_is_admin := COALESCE(public.is_admin_or_socio(p_user_id, v_tenant_id), false);
  IF v_current.status <> 'em_lancamento'
     AND v_current.created_by <> p_user_id
     AND NOT v_is_admin THEN
    RAISE EXCEPTION 'Despesa só pode ser editada em lançamento pelo criador';
  END IF;

  IF p_payload ? 'valor' THEN
    v_valor := COALESCE(NULLIF(replace(p_payload->>'valor', ',', '.'), '')::numeric, 0);
    IF v_valor <= 0 THEN
      RAISE EXCEPTION 'Valor da despesa é obrigatório e deve ser maior que zero';
    END IF;
  END IF;

  UPDATE operations.despesas d
  SET
    cliente_id = COALESCE((
      SELECT c.cliente_id FROM contracts.contratos c
      WHERE c.id = d.contrato_id AND c.tenant_id = d.tenant_id LIMIT 1
    ), d.cliente_id),
    data_lancamento = COALESCE(NULLIF(p_payload->>'data_lancamento', '')::date, d.data_lancamento),
    categoria = COALESCE(NULLIF(trim(p_payload->>'categoria'), ''), d.categoria),
    valor = CASE WHEN p_payload ? 'valor' THEN v_valor ELSE d.valor END,
    descricao = CASE WHEN p_payload ? 'descricao' THEN COALESCE(p_payload->>'descricao', '') ELSE d.descricao END,
    reembolsavel = CASE WHEN p_payload ? 'reembolsavel' THEN COALESCE((p_payload->>'reembolsavel')::boolean, true) ELSE d.reembolsavel END,
    status = CASE
      WHEN p_payload ? 'status' AND (p_payload->>'status') IN ('em_lancamento', 'revisao', 'aprovado', 'cancelado')
        THEN p_payload->>'status'
      ELSE d.status END,
    arquivo_nome = CASE
      WHEN COALESCE(NULLIF(trim(p_payload->>'arquivo_base64'), ''), '') <> '' THEN COALESCE(NULLIF(trim(p_payload->>'arquivo_nome'), ''), d.arquivo_nome)
      ELSE d.arquivo_nome END,
    mime_type = CASE
      WHEN COALESCE(NULLIF(trim(p_payload->>'arquivo_base64'), ''), '') <> '' THEN NULLIF(p_payload->>'mime_type', '')
      ELSE d.mime_type END,
    tamanho_bytes = CASE
      WHEN COALESCE(NULLIF(trim(p_payload->>'arquivo_base64'), ''), '') <> '' THEN NULLIF(p_payload->>'tamanho_bytes', '')::bigint
      ELSE d.tamanho_bytes END,
    arquivo = CASE
      WHEN COALESCE(NULLIF(trim(p_payload->>'arquivo_base64'), ''), '') <> '' THEN decode(p_payload->>'arquivo_base64', 'base64')
      ELSE d.arquivo END,
    updated_at = now(),
    updated_by = p_user_id
  WHERE d.id = p_despesa_id AND d.tenant_id = v_tenant_id;

  -- Remover anexos adicionais selecionados
  IF jsonb_typeof(p_payload->'anexos_remove') = 'array' THEN
    DELETE FROM operations.despesa_anexos a
    WHERE a.despesa_id = p_despesa_id AND a.tenant_id = v_tenant_id
      AND a.id IN (SELECT (e #>> '{}')::uuid FROM jsonb_array_elements(p_payload->'anexos_remove') e);
  END IF;

  -- Adicionar novos anexos
  IF jsonb_typeof(p_payload->'anexos_extra_add') = 'array' THEN
    INSERT INTO operations.despesa_anexos (tenant_id, despesa_id, arquivo, arquivo_nome, mime_type, tamanho_bytes)
    SELECT v_tenant_id, p_despesa_id,
      decode(e->>'arquivo_base64', 'base64'),
      trim(e->>'arquivo_nome'),
      NULLIF(e->>'mime_type', ''),
      NULLIF(e->>'tamanho_bytes', '')::bigint
    FROM jsonb_array_elements(p_payload->'anexos_extra_add') e
    WHERE COALESCE(NULLIF(trim(e->>'arquivo_base64'), ''), '') <> ''
      AND COALESCE(NULLIF(trim(e->>'arquivo_nome'), ''), '') <> '';
  END IF;

  RETURN jsonb_build_object('id', p_despesa_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_despesas(p_user_id uuid, p_filters jsonb DEFAULT '{}'::jsonb)
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
        'reembolsavel', COALESCE(d.reembolsavel, true),
        'arquivo_nome', d.arquivo_nome,
        'mime_type', d.mime_type,
        'tamanho_bytes', d.tamanho_bytes,
        'anexos', (
          SELECT jsonb_agg(item ORDER BY ord)
          FROM (
            SELECT 0 AS ord, jsonb_build_object(
              'id', d.id, 'kind', 'primario',
              'arquivo_nome', d.arquivo_nome, 'mime_type', d.mime_type, 'tamanho_bytes', d.tamanho_bytes
            ) AS item
            WHERE d.arquivo_nome IS NOT NULL
            UNION ALL
            SELECT 1 AS ord, jsonb_build_object(
              'id', a.id, 'kind', 'extra',
              'arquivo_nome', a.arquivo_nome, 'mime_type', a.mime_type, 'tamanho_bytes', a.tamanho_bytes
            )
            FROM operations.despesa_anexos a
            WHERE a.despesa_id = d.id
          ) s
        ),
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
$function$;

CREATE OR REPLACE FUNCTION public.start_faturamento_despesas_fallback(p_user_id uuid, p_payload jsonb)
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

  -- Sincroniza cliente_id legado para garantir elegibilidade consistente.
  UPDATE operations.despesas d
  SET cliente_id = c.cliente_id
  FROM contracts.contratos c
  WHERE c.id = d.contrato_id
    AND c.tenant_id = d.tenant_id
    AND d.tenant_id = v_tenant_id
    AND (d.cliente_id IS NULL OR d.cliente_id <> c.cliente_id);

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

  WITH eligible_despesas AS (
    SELECT
      d.id AS origem_id,
      d.data_lancamento AS data_referencia,
      COALESCE(d.valor, 0)::numeric(14,2) AS valor_informado,
      d.categoria,
      d.descricao,
      c.id AS contrato_id,
      c.numero AS contrato_numero,
      c.nome_contrato,
      COALESCE(d.cliente_id, c.cliente_id) AS cliente_id,
      cli.nome AS cliente_nome,
      cs.id AS caso_id,
      cs.numero AS caso_numero,
      cs.nome AS caso_nome
    FROM operations.despesas d
    JOIN contracts.contratos c
      ON c.id = d.contrato_id
     AND c.tenant_id = v_tenant_id
    JOIN crm.clientes cli
      ON cli.id = COALESCE(d.cliente_id, c.cliente_id)
     AND cli.tenant_id = v_tenant_id
    JOIN contracts.casos cs
      ON cs.id = d.caso_id
     AND cs.tenant_id = v_tenant_id
    WHERE d.tenant_id = v_tenant_id
      AND d.data_lancamento BETWEEN v_data_inicio AND v_data_fim
      AND d.status IN ('em_lancamento', 'revisao', 'aprovado')
      AND COALESCE(d.reembolsavel, true) = true
      AND c.status = 'ativo'
      AND cs.status <> 'inativo'
      AND (
        v_alvo_tipo = 'itens'
        OR (v_alvo_tipo = 'cliente' AND COALESCE(d.cliente_id, c.cliente_id) = ANY(v_alvo_ids))
        OR (v_alvo_tipo = 'contrato' AND c.id = ANY(v_alvo_ids))
        OR (v_alvo_tipo = 'caso' AND cs.id = ANY(v_alvo_ids))
      )
      AND (
        v_search IS NULL
        OR cli.nome ILIKE '%' || v_search || '%'
        OR c.nome_contrato ILIKE '%' || v_search || '%'
        OR cs.nome ILIKE '%' || v_search || '%'
        OR COALESCE(d.categoria, '') ILIKE '%' || v_search || '%'
        OR COALESCE(d.descricao, '') ILIKE '%' || v_search || '%'
        OR c.numero::text ILIKE '%' || v_search || '%'
        OR cs.numero::text ILIKE '%' || v_search || '%'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM finance.billing_items bi
        WHERE bi.tenant_id = v_tenant_id
          AND bi.origem_tipo = 'despesa'
          AND bi.origem_id = d.id
          AND bi.status <> 'cancelado'
      )
  ),
  inserted_despesas AS (
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
      d.cliente_id,
      d.contrato_id,
      d.caso_id,
      'despesa',
      d.origem_id,
      d.data_referencia,
      v_data_inicio,
      v_data_fim,
      'em_revisao',
      d.valor_informado,
      0,
      jsonb_build_object(
        'cliente_id', d.cliente_id,
        'cliente_nome', d.cliente_nome,
        'contrato_id', d.contrato_id,
        'contrato_numero', d.contrato_numero,
        'contrato_nome', d.nome_contrato,
        'caso_id', d.caso_id,
        'caso_numero', d.caso_numero,
        'caso_nome', d.caso_nome,
        'regra_nome', 'Despesa',
        'regra_cobranca', 'despesa',
        'categoria', d.categoria,
        'descricao', COALESCE(d.descricao, d.categoria, 'Despesa'),
        'origem', 'despesa'
      ),
      p_user_id,
      p_user_id
    FROM eligible_despesas d
    RETURNING origem_id
  )
  SELECT COUNT(*)::int INTO v_items_count
  FROM inserted_despesas;

  IF v_items_count = 0 THEN
    DELETE FROM finance.billing_batches WHERE id = v_batch_id;
    RAISE EXCEPTION 'Nenhum item elegível encontrado para o período/filtro';
  END IF;

  UPDATE operations.despesas d
  SET
    status = 'revisao',
    updated_at = now(),
    updated_by = p_user_id
  WHERE d.tenant_id = v_tenant_id
    AND d.id IN (SELECT origem_id FROM finance.billing_items WHERE tenant_id = v_tenant_id AND billing_batch_id = v_batch_id AND origem_tipo = 'despesa')
    AND d.status = 'em_lancamento';

  RETURN jsonb_build_object(
    'batch_id', v_batch_id,
    'batch_numero', v_batch_numero,
    'itens_criados', v_items_count
  );
END;
$function$;
