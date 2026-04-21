-- RF-088 AA-5: salário mínimo editável (MVP) — tabela config.salario_minimo, RPCs e integração em create_caso / update_caso / start_faturamento_flow.
-- Padrão: sem RLS; acesso via RPC SECURITY DEFINER (como finance.billing_items).

CREATE SCHEMA IF NOT EXISTS config;

CREATE TABLE IF NOT EXISTS config.salario_minimo (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES core.tenants(id) ON DELETE CASCADE,
  valor NUMERIC(10,2) NOT NULL CHECK (valor > 0),
  vigencia_desde DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_salario_minimo_tenant_vigencia
  ON config.salario_minimo(tenant_id, vigencia_desde);

CREATE INDEX IF NOT EXISTS idx_salario_minimo_tenant
  ON config.salario_minimo(tenant_id);

COMMENT ON TABLE config.salario_minimo IS
  'RF-088: valor de SM por tenant com histórico por vigência_desde; snapshot em billing_items.';

GRANT ALL ON TABLE config.salario_minimo TO postgres;
GRANT ALL ON TABLE config.salario_minimo TO service_role;

INSERT INTO core.permissions (tenant_id, chave, descricao, categoria)
SELECT t.id, 'config.salario_minimo.read', 'Visualizar salário mínimo e histórico', 'config'
FROM core.tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM core.permissions p WHERE p.tenant_id = t.id AND p.chave = 'config.salario_minimo.read'
);

INSERT INTO core.permissions (tenant_id, chave, descricao, categoria)
SELECT t.id, 'config.salario_minimo.write', 'Editar salário mínimo (admin)', 'config'
FROM core.tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM core.permissions p WHERE p.tenant_id = t.id AND p.chave = 'config.salario_minimo.write'
);

INSERT INTO config.salario_minimo (tenant_id, valor, vigencia_desde)
VALUES ('d51463dd-a6b3-40e7-9488-854eba80a210', 1518.00, '2026-01-01')
ON CONFLICT (tenant_id, vigencia_desde) DO NOTHING;

-- ---------------------------------------------------------------------------
-- RPCs SM
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_salario_minimo_atual(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, config, core
AS $function$
DECLARE
  v_tenant_id uuid;
  r record;
BEGIN
  SELECT tenant_id INTO v_tenant_id
  FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id AND tu.status = 'ativo'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não associado a tenant';
  END IF;

  SELECT sm.valor, sm.vigencia_desde, sm.updated_at
  INTO r
  FROM config.salario_minimo sm
  WHERE sm.tenant_id = v_tenant_id
  ORDER BY sm.vigencia_desde DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('valor', NULL, 'vigencia_desde', NULL, 'updated_at', NULL);
  END IF;

  RETURN jsonb_build_object(
    'valor', r.valor,
    'vigencia_desde', r.vigencia_desde,
    'updated_at', r.updated_at
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_salario_minimo(p_user_id uuid, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, config, core
AS $function$
DECLARE
  v_tenant_id uuid;
  v_can_write boolean := false;
  v_valor numeric;
  v_vigencia date;
BEGIN
  SELECT tenant_id INTO v_tenant_id
  FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id AND tu.status = 'ativo'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não associado a tenant';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.get_user_permissions(p_user_id) p
    WHERE p.permission_key IN (
      'config.salario_minimo.write',
      'config.*',
      '*'
    )
  ) INTO v_can_write;

  IF NOT v_can_write THEN
    RAISE EXCEPTION 'Sem permissão para editar salário mínimo';
  END IF;

  v_valor := (p_payload->>'valor')::numeric;
  IF v_valor IS NULL OR v_valor <= 0 THEN
    RAISE EXCEPTION 'valor deve ser numérico maior que zero';
  END IF;

  v_vigencia := COALESCE(NULLIF(p_payload->>'vigencia_desde', '')::date, CURRENT_DATE);

  INSERT INTO config.salario_minimo (tenant_id, valor, vigencia_desde, updated_by)
  VALUES (v_tenant_id, v_valor, v_vigencia, p_user_id)
  ON CONFLICT (tenant_id, vigencia_desde)
  DO UPDATE SET
    valor = EXCLUDED.valor,
    updated_at = now(),
    updated_by = EXCLUDED.updated_by;

  RETURN public.get_salario_minimo_atual(p_user_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_salario_minimo_historico(p_user_id uuid, p_limit integer DEFAULT 5)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, config, core
AS $function$
DECLARE
  v_tenant_id uuid;
  v_can_read boolean := false;
BEGIN
  SELECT tenant_id INTO v_tenant_id
  FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id AND tu.status = 'ativo'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não associado a tenant';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.get_user_permissions(p_user_id) p
    WHERE p.permission_key IN (
      'config.salario_minimo.read',
      'config.salario_minimo.write',
      'config.*',
      '*'
    )
  ) INTO v_can_read;

  IF NOT v_can_read THEN
    RAISE EXCEPTION 'Sem permissão para visualizar histórico de salário mínimo';
  END IF;

  RETURN (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'valor', x.valor,
          'vigencia_desde', x.vigencia_desde,
          'updated_at', x.updated_at
        )
        ORDER BY x.vigencia_desde DESC
      ),
      '[]'::jsonb
    )
    FROM (
      SELECT sm.valor, sm.vigencia_desde, sm.updated_at
      FROM config.salario_minimo sm
      WHERE sm.tenant_id = v_tenant_id
      ORDER BY sm.vigencia_desde DESC
      LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 5), 100))
    ) x
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_caso(p_user_id uuid, p_contrato_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_tenant_id uuid;
  v_caso_id uuid;
  v_caso_numero bigint;
  v_status varchar;
  v_aprovador_id uuid;
  v_regras_financeiras jsonb;
  v_regra_principal jsonb;
  v_natureza text;
  v_polo_final varchar(10);
BEGIN
  SELECT tenant_id INTO v_tenant_id
  FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id AND tu.status = 'ativo'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não associado a tenant';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM contracts.contratos c
    WHERE c.id = p_contrato_id AND c.tenant_id = v_tenant_id
  ) THEN
    RAISE EXCEPTION 'Contrato não encontrado';
  END IF;

  IF COALESCE(trim(p_payload->>'nome'), '') = '' THEN
    RAISE EXCEPTION 'Nome do caso é obrigatório';
  END IF;

  IF NULLIF(p_payload->>'servico_id', '') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM operations.categorias_servico s
       WHERE s.id = (p_payload->>'servico_id')::uuid
         AND s.tenant_id = v_tenant_id
     ) THEN
    RAISE EXCEPTION 'Serviço do caso inválido';
  END IF;

  FOR v_aprovador_id IN
    SELECT NULLIF(item->>'colaborador_id', '')::uuid
    FROM jsonb_array_elements(COALESCE(p_payload->'timesheet_config'->'aprovadores', '[]'::jsonb)) item
  LOOP
    IF v_aprovador_id IS NULL THEN
      CONTINUE;
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM people.colaboradores col
      WHERE col.id = v_aprovador_id
        AND col.tenant_id = v_tenant_id
        AND lower(col.categoria::text) = 'socio'
    ) THEN
      RAISE EXCEPTION 'Aprovadores devem ser sócios';
    END IF;
  END LOOP;

  v_status := COALESCE(NULLIF(p_payload->>'status', ''), 'ativo');
  IF v_status NOT IN ('rascunho', 'ativo', 'inativo') THEN
    RAISE EXCEPTION 'Status de caso inválido';
  END IF;

  IF p_payload ? 'regras_financeiras'
     AND jsonb_typeof(p_payload->'regras_financeiras') = 'array'
     AND jsonb_array_length(p_payload->'regras_financeiras') > 0 THEN
    v_regras_financeiras := p_payload->'regras_financeiras';
  ELSE
    v_regras_financeiras := jsonb_build_array(
      jsonb_build_object(
        'id', 'legacy-' || gen_random_uuid()::text,
        'status', CASE
          WHEN v_status = 'rascunho' THEN 'rascunho'
          WHEN v_status = 'inativo' THEN 'encerrado'
          ELSE 'ativo'
        END,
        'moeda', COALESCE(NULLIF(p_payload->>'moeda', ''), 'real'),
        'tipo_cobranca_documento', NULLIF(p_payload->>'tipo_cobranca_documento', ''),
        'data_inicio_faturamento', NULLIF(p_payload->>'data_inicio_faturamento', ''),
        'dia_inicio_faturamento', NULLIF(p_payload->>'dia_inicio_faturamento', ''),
        'pagamento_dia_mes', NULLIF(p_payload->>'pagamento_dia_mes', ''),
        'inicio_vigencia', NULLIF(p_payload->>'inicio_vigencia', ''),
        'periodo_reajuste', NULLIF(p_payload->>'periodo_reajuste', ''),
        'data_proximo_reajuste', NULLIF(p_payload->>'data_proximo_reajuste', ''),
        'data_ultimo_reajuste', NULLIF(p_payload->>'data_ultimo_reajuste', ''),
        'indice_reajuste', NULLIF(p_payload->>'indice_reajuste', ''),
        'regra_cobranca', NULLIF(p_payload->>'regra_cobranca', ''),
        'regra_cobranca_config', COALESCE(p_payload->'regra_cobranca_config', '{}'::jsonb),
        'pagadores_servico', COALESCE(p_payload->'pagadores_servico', '[]'::jsonb)
      )
    );
  END IF;

  IF v_regras_financeiras IS NOT NULL
     AND jsonb_typeof(v_regras_financeiras) = 'array'
     AND jsonb_array_length(v_regras_financeiras) > 0 THEN
    v_regras_financeiras := (
      SELECT COALESCE(jsonb_agg(
        CASE
          WHEN COALESCE(NULLIF(x->>'regra_cobranca', ''), '') = 'salario_minimo' THEN x
          ELSE x - 'quantidade_sm'
        END
      ), '[]'::jsonb)
      FROM jsonb_array_elements(v_regras_financeiras) AS t(x)
    );
    FOR elem IN SELECT value FROM jsonb_array_elements(v_regras_financeiras) AS e(value) LOOP
      IF COALESCE(NULLIF(elem->>'regra_cobranca', ''), '') = 'salario_minimo' THEN
        IF NULLIF(elem->>'quantidade_sm', '')::numeric IS NULL
           OR NULLIF(elem->>'quantidade_sm', '')::numeric <= 0 THEN
          RAISE EXCEPTION 'Para regra salário mínimo, quantidade_sm é obrigatória e deve ser maior que zero';
        END IF;
      END IF;
    END LOOP;
  END IF;

  v_regra_principal := public.pick_regra_financeira_principal(v_regras_financeiras);

  v_natureza := lower(trim(COALESCE(
    NULLIF(v_regra_principal->>'natureza_caso', ''),
    NULLIF(p_payload->>'natureza_caso', ''),
    ''
  )));

  IF v_natureza = 'contencioso' THEN
    IF NULLIF(trim(lower(COALESCE(p_payload->>'polo', ''))), '') IS NULL THEN
      RAISE EXCEPTION 'Polo é obrigatório quando natureza_caso é contencioso';
    END IF;
    IF trim(lower(COALESCE(p_payload->>'polo', ''))) NOT IN ('ativo', 'passivo') THEN
      RAISE EXCEPTION 'Polo inválido (use ativo ou passivo)';
    END IF;
    v_polo_final := trim(lower(COALESCE(p_payload->>'polo', '')))::varchar(10);
  ELSE
    v_polo_final := NULL;
  END IF;

  INSERT INTO contracts.casos (
    tenant_id,
    contrato_id,
    nome,
    servico_id,
    produto_id,
    responsavel_id,
    moeda,
    tipo_cobranca_documento,
    data_inicio_faturamento,
    dia_inicio_faturamento,
    polo,
    pagamento_dia_mes,
    inicio_vigencia,
    periodo_reajuste,
    data_proximo_reajuste,
    data_ultimo_reajuste,
    indice_reajuste,
    regra_cobranca,
    regra_cobranca_config,
    regras_financeiras,
    centro_custo_rateio,
    pagadores_servico,
    despesas_config,
    pagadores_despesa,
    timesheet_config,
    indicacao_config,
    status,
    ativo,
    created_by,
    updated_by
  ) VALUES (
    v_tenant_id,
    p_contrato_id,
    p_payload->>'nome',
    NULLIF(p_payload->>'servico_id', '')::uuid,
    NULLIF(p_payload->>'produto_id', '')::uuid,
    NULLIF(p_payload->>'responsavel_id', '')::uuid,
    COALESCE(NULLIF(v_regra_principal->>'moeda', ''), NULLIF(p_payload->>'moeda', ''), 'real'),
    COALESCE(NULLIF(v_regra_principal->>'tipo_cobranca_documento', ''), NULLIF(p_payload->>'tipo_cobranca_documento', '')),
    COALESCE(NULLIF(v_regra_principal->>'data_inicio_faturamento', '')::date, NULLIF(p_payload->>'data_inicio_faturamento', '')::date),
    COALESCE(
      NULLIF(v_regra_principal->>'dia_inicio_faturamento', '')::integer,
      NULLIF(p_payload->>'dia_inicio_faturamento', '')::integer,
      CASE
        WHEN COALESCE(
          NULLIF(v_regra_principal->>'data_inicio_faturamento', '')::date,
          NULLIF(p_payload->>'data_inicio_faturamento', '')::date
        ) IS NOT NULL THEN
          EXTRACT(
            DAY FROM COALESCE(
              NULLIF(v_regra_principal->>'data_inicio_faturamento', '')::date,
              NULLIF(p_payload->>'data_inicio_faturamento', '')::date
            )
          )::integer
        ELSE NULL
      END
    ),
    v_polo_final,
    COALESCE(NULLIF(v_regra_principal->>'pagamento_dia_mes', '')::integer, NULLIF(p_payload->>'pagamento_dia_mes', '')::integer),
    COALESCE(NULLIF(v_regra_principal->>'inicio_vigencia', '')::date, NULLIF(p_payload->>'inicio_vigencia', '')::date),
    COALESCE(NULLIF(v_regra_principal->>'periodo_reajuste', ''), NULLIF(p_payload->>'periodo_reajuste', '')),
    COALESCE(NULLIF(v_regra_principal->>'data_proximo_reajuste', '')::date, NULLIF(p_payload->>'data_proximo_reajuste', '')::date),
    COALESCE(NULLIF(v_regra_principal->>'data_ultimo_reajuste', '')::date, NULLIF(p_payload->>'data_ultimo_reajuste', '')::date),
    COALESCE(NULLIF(v_regra_principal->>'indice_reajuste', ''), NULLIF(p_payload->>'indice_reajuste', '')),
    COALESCE(NULLIF(v_regra_principal->>'regra_cobranca', ''), NULLIF(p_payload->>'regra_cobranca', '')),
    COALESCE(v_regra_principal->'regra_cobranca_config', p_payload->'regra_cobranca_config', '{}'::jsonb),
    COALESCE(v_regras_financeiras, '[]'::jsonb),
    COALESCE(p_payload->'centro_custo_rateio', '[]'::jsonb),
    COALESCE(v_regra_principal->'pagadores_servico', p_payload->'pagadores_servico', '[]'::jsonb),
    COALESCE(p_payload->'despesas_config', '{}'::jsonb),
    COALESCE(p_payload->'pagadores_despesa', '[]'::jsonb),
    COALESCE(p_payload->'timesheet_config', '{}'::jsonb),
    COALESCE(p_payload->'indicacao_config', '{}'::jsonb),
    v_status,
    (v_status <> 'inativo'),
    p_user_id,
    p_user_id
  ) RETURNING id, numero INTO v_caso_id, v_caso_numero;

  UPDATE contracts.contratos c
  SET status = 'ativo', updated_at = now(), updated_by = p_user_id
  WHERE c.id = p_contrato_id
    AND c.tenant_id = v_tenant_id
    AND c.status = 'rascunho';

  RETURN jsonb_build_object('id', v_caso_id, 'numero', v_caso_numero);
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_caso(p_user_id uuid, p_caso_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_tenant_id uuid;
  v_next_status varchar;
  v_aprovador_id uuid;
  v_regras_financeiras jsonb;
  v_regra_principal jsonb;
  v_old_regras jsonb;
  v_old_polo varchar(10);
  v_natureza text;
  v_polo_final varchar(10);
BEGIN
  SELECT tenant_id INTO v_tenant_id
  FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id AND tu.status = 'ativo'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não associado a tenant';
  END IF;

  SELECT cs.regras_financeiras, cs.polo
  INTO v_old_regras, v_old_polo
  FROM contracts.casos cs
  WHERE cs.id = p_caso_id AND cs.tenant_id = v_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Caso não encontrado';
  END IF;

  IF p_payload ? 'servico_id'
     AND NULLIF(p_payload->>'servico_id', '') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM operations.categorias_servico s
       WHERE s.id = (p_payload->>'servico_id')::uuid
         AND s.tenant_id = v_tenant_id
     ) THEN
    RAISE EXCEPTION 'Serviço do caso inválido';
  END IF;

  IF p_payload ? 'timesheet_config' THEN
    FOR v_aprovador_id IN
      SELECT NULLIF(item->>'colaborador_id', '')::uuid
      FROM jsonb_array_elements(COALESCE(p_payload->'timesheet_config'->'aprovadores', '[]'::jsonb)) item
    LOOP
      IF v_aprovador_id IS NULL THEN
        CONTINUE;
      END IF;
      IF NOT EXISTS (
        SELECT 1
        FROM people.colaboradores col
        WHERE col.id = v_aprovador_id
          AND col.tenant_id = v_tenant_id
          AND lower(col.categoria::text) = 'socio'
      ) THEN
        RAISE EXCEPTION 'Aprovadores devem ser sócios';
      END IF;
    END LOOP;
  END IF;

  v_next_status := NULLIF(p_payload->>'status', '');
  IF v_next_status IS NOT NULL AND v_next_status NOT IN ('rascunho', 'ativo', 'inativo') THEN
    RAISE EXCEPTION 'Status de caso inválido';
  END IF;

  IF p_payload ? 'regras_financeiras'
     AND jsonb_typeof(p_payload->'regras_financeiras') = 'array'
     AND jsonb_array_length(p_payload->'regras_financeiras') > 0 THEN
    v_regras_financeiras := p_payload->'regras_financeiras';
  ELSE
    v_regras_financeiras := v_old_regras;
  END IF;

  IF v_regras_financeiras IS NOT NULL
     AND jsonb_typeof(v_regras_financeiras) = 'array'
     AND jsonb_array_length(v_regras_financeiras) > 0 THEN
    v_regras_financeiras := (
      SELECT COALESCE(jsonb_agg(
        CASE
          WHEN COALESCE(NULLIF(x->>'regra_cobranca', ''), '') = 'salario_minimo' THEN x
          ELSE x - 'quantidade_sm'
        END
      ), '[]'::jsonb)
      FROM jsonb_array_elements(v_regras_financeiras) AS t(x)
    );
    FOR elem IN SELECT value FROM jsonb_array_elements(v_regras_financeiras) AS e(value) LOOP
      IF COALESCE(NULLIF(elem->>'regra_cobranca', ''), '') = 'salario_minimo' THEN
        IF NULLIF(elem->>'quantidade_sm', '')::numeric IS NULL
           OR NULLIF(elem->>'quantidade_sm', '')::numeric <= 0 THEN
          RAISE EXCEPTION 'Para regra salário mínimo, quantidade_sm é obrigatória e deve ser maior que zero';
        END IF;
      END IF;
    END LOOP;
  END IF;

  v_regra_principal := public.pick_regra_financeira_principal(v_regras_financeiras);

  v_natureza := lower(trim(COALESCE(
    NULLIF(v_regra_principal->>'natureza_caso', ''),
    NULLIF(p_payload->>'natureza_caso', ''),
    ''
  )));

  IF v_natureza <> 'contencioso' THEN
    v_polo_final := NULL;
  ELSE
    IF p_payload ? 'polo' THEN
      IF NULLIF(trim(lower(COALESCE(p_payload->>'polo', ''))), '') IS NULL THEN
        RAISE EXCEPTION 'Polo é obrigatório quando natureza_caso é contencioso';
      END IF;
      IF trim(lower(COALESCE(p_payload->>'polo', ''))) NOT IN ('ativo', 'passivo') THEN
        RAISE EXCEPTION 'Polo inválido (use ativo ou passivo)';
      END IF;
      v_polo_final := trim(lower(COALESCE(p_payload->>'polo', '')))::varchar(10);
    ELSE
      v_polo_final := v_old_polo;
      IF v_polo_final IS NOT NULL THEN
        v_polo_final := lower(v_polo_final::text)::varchar(10);
      END IF;
      IF v_polo_final IS NULL AND (p_payload ? 'regras_financeiras') THEN
        RAISE EXCEPTION 'Polo é obrigatório quando natureza_caso é contencioso';
      END IF;
    END IF;
  END IF;

  UPDATE contracts.casos cs
  SET
    nome = COALESCE(NULLIF(p_payload->>'nome', ''), cs.nome),
    servico_id = CASE
      WHEN p_payload ? 'servico_id' THEN NULLIF(p_payload->>'servico_id', '')::uuid
      ELSE cs.servico_id
    END,
    produto_id = COALESCE(NULLIF(p_payload->>'produto_id', '')::uuid, cs.produto_id),
    responsavel_id = COALESCE(NULLIF(p_payload->>'responsavel_id', '')::uuid, cs.responsavel_id),
    moeda = CASE
      WHEN v_regra_principal IS NOT NULL THEN COALESCE(NULLIF(v_regra_principal->>'moeda', ''), cs.moeda)
      ELSE COALESCE(NULLIF(p_payload->>'moeda', ''), cs.moeda)
    END,
    tipo_cobranca_documento = CASE
      WHEN v_regra_principal IS NOT NULL THEN COALESCE(NULLIF(v_regra_principal->>'tipo_cobranca_documento', ''), cs.tipo_cobranca_documento)
      ELSE COALESCE(NULLIF(p_payload->>'tipo_cobranca_documento', ''), cs.tipo_cobranca_documento)
    END,
    data_inicio_faturamento = CASE
      WHEN v_regra_principal IS NOT NULL THEN COALESCE(NULLIF(v_regra_principal->>'data_inicio_faturamento', '')::date, cs.data_inicio_faturamento)
      ELSE COALESCE(NULLIF(p_payload->>'data_inicio_faturamento', '')::date, cs.data_inicio_faturamento)
    END,
    dia_inicio_faturamento = CASE
      WHEN v_regra_principal IS NOT NULL THEN
        COALESCE(
          NULLIF(v_regra_principal->>'dia_inicio_faturamento', '')::integer,
          CASE
            WHEN NULLIF(v_regra_principal->>'data_inicio_faturamento', '') IS NOT NULL THEN
              EXTRACT(DAY FROM NULLIF(v_regra_principal->>'data_inicio_faturamento', '')::date)::integer
            ELSE NULL
          END,
          cs.dia_inicio_faturamento
        )
      ELSE
        COALESCE(
          NULLIF(p_payload->>'dia_inicio_faturamento', '')::integer,
          CASE
            WHEN NULLIF(p_payload->>'data_inicio_faturamento', '') IS NOT NULL THEN
              EXTRACT(DAY FROM NULLIF(p_payload->>'data_inicio_faturamento', '')::date)::integer
            ELSE NULL
          END,
          cs.dia_inicio_faturamento
        )
    END,
    polo = v_polo_final,
    pagamento_dia_mes = CASE
      WHEN v_regra_principal IS NOT NULL THEN COALESCE(NULLIF(v_regra_principal->>'pagamento_dia_mes', '')::integer, cs.pagamento_dia_mes)
      ELSE COALESCE(NULLIF(p_payload->>'pagamento_dia_mes', '')::integer, cs.pagamento_dia_mes)
    END,
    inicio_vigencia = CASE
      WHEN v_regra_principal IS NOT NULL THEN COALESCE(NULLIF(v_regra_principal->>'inicio_vigencia', '')::date, cs.inicio_vigencia)
      ELSE COALESCE(NULLIF(p_payload->>'inicio_vigencia', '')::date, cs.inicio_vigencia)
    END,
    periodo_reajuste = CASE
      WHEN v_regra_principal IS NOT NULL THEN COALESCE(NULLIF(v_regra_principal->>'periodo_reajuste', ''), cs.periodo_reajuste)
      ELSE COALESCE(NULLIF(p_payload->>'periodo_reajuste', ''), cs.periodo_reajuste)
    END,
    data_proximo_reajuste = CASE
      WHEN v_regra_principal IS NOT NULL THEN COALESCE(NULLIF(v_regra_principal->>'data_proximo_reajuste', '')::date, cs.data_proximo_reajuste)
      ELSE COALESCE(NULLIF(p_payload->>'data_proximo_reajuste', '')::date, cs.data_proximo_reajuste)
    END,
    data_ultimo_reajuste = CASE
      WHEN v_regra_principal IS NOT NULL THEN COALESCE(NULLIF(v_regra_principal->>'data_ultimo_reajuste', '')::date, cs.data_ultimo_reajuste)
      ELSE COALESCE(NULLIF(p_payload->>'data_ultimo_reajuste', '')::date, cs.data_ultimo_reajuste)
    END,
    indice_reajuste = CASE
      WHEN v_regra_principal IS NOT NULL THEN COALESCE(NULLIF(v_regra_principal->>'indice_reajuste', ''), cs.indice_reajuste)
      ELSE COALESCE(NULLIF(p_payload->>'indice_reajuste', ''), cs.indice_reajuste)
    END,
    regra_cobranca = CASE
      WHEN v_regra_principal IS NOT NULL THEN COALESCE(NULLIF(v_regra_principal->>'regra_cobranca', ''), cs.regra_cobranca)
      ELSE COALESCE(NULLIF(p_payload->>'regra_cobranca', ''), cs.regra_cobranca)
    END,
    regra_cobranca_config = CASE
      WHEN v_regra_principal IS NOT NULL THEN COALESCE(v_regra_principal->'regra_cobranca_config', cs.regra_cobranca_config)
      ELSE COALESCE(p_payload->'regra_cobranca_config', cs.regra_cobranca_config)
    END,
    regras_financeiras = COALESCE(v_regras_financeiras, cs.regras_financeiras),
    centro_custo_rateio = COALESCE(p_payload->'centro_custo_rateio', cs.centro_custo_rateio),
    pagadores_servico = CASE
      WHEN v_regra_principal IS NOT NULL THEN COALESCE(v_regra_principal->'pagadores_servico', cs.pagadores_servico)
      ELSE COALESCE(p_payload->'pagadores_servico', cs.pagadores_servico)
    END,
    despesas_config = COALESCE(p_payload->'despesas_config', cs.despesas_config),
    pagadores_despesa = COALESCE(p_payload->'pagadores_despesa', cs.pagadores_despesa),
    timesheet_config = COALESCE(p_payload->'timesheet_config', cs.timesheet_config),
    indicacao_config = COALESCE(p_payload->'indicacao_config', cs.indicacao_config),
    status = COALESCE(v_next_status, cs.status),
    ativo = CASE COALESCE(v_next_status, cs.status) WHEN 'inativo' THEN false ELSE true END,
    updated_at = now(),
    updated_by = p_user_id
  WHERE cs.id = p_caso_id
    AND cs.tenant_id = v_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Caso não encontrado';
  END IF;

  RETURN jsonb_build_object('id', p_caso_id);
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
      cs.nome AS caso_nome
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
    WHERE t.tenant_id = v_tenant_id
      AND t.data_lancamento BETWEEN v_data_inicio AND v_data_fim
      AND c.status = 'ativo'
      AND cs.status <> 'inativo'
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
          COALESCE(NULLIF(ers.rule_item->>'quantidade_sm', '')::numeric, 0)
          * COALESCE(ers.valor_sm_ref, 0)
        ELSE 0
      END::numeric(14,2) AS valor_regra
    FROM eligible_rules_enriched ers
    WHERE ers.regra_cobranca IN ('mensal', 'mensalidade_processo', 'projeto', 'exito', 'salario_minimo')
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
        'origem', 'timesheet'
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
        'quantidade_sm', CASE WHEN r.regra_cobranca = 'salario_minimo' THEN NULLIF(r.rule_item->>'quantidade_sm', '')::numeric ELSE NULL END,
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
$function$;

