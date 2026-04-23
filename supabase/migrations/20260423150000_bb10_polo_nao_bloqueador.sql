-- BB-10 — Polo deixa de bloquear salvamento em casos contenciosos.
-- Antes: public.create_caso / public.update_caso lançavam RAISE EXCEPTION
--        'Polo é obrigatório quando natureza_caso é contencioso' quando contencioso sem polo.
-- Depois: polo vazio em contencioso é aceito (v_polo_final := NULL).
-- Preservado: se o campo polo for enviado com valor, deve estar em ('ativo','passivo')
--             (RAISE EXCEPTION 'Polo inválido (use ativo ou passivo)' continua ativo).
-- Preservado: CHECK constraint casos_polo_chk (polo IS NULL OR polo IN ('ativo','passivo')).
--
-- IMPORTANTE (BB-8 lesson): assinaturas das funções são EXATAMENTE as mesmas da migration
-- 20260421180000_rf088_aa5_salario_minimo_mvp.sql para que o CREATE OR REPLACE substitua
-- limpo sem criar overload. Se alterar parâmetros, usar DROP FUNCTION antes.
--
-- Idempotente: aplicar duas vezes é no-op (CREATE OR REPLACE substitui pelo corpo atual).

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

  -- BB-10: polo deixa de ser obrigatório em contencioso.
  -- Se fornecido com valor, continua sendo validado contra ('ativo','passivo').
  IF v_natureza = 'contencioso' THEN
    IF NULLIF(trim(lower(COALESCE(p_payload->>'polo', ''))), '') IS NULL THEN
      v_polo_final := NULL;
    ELSIF trim(lower(COALESCE(p_payload->>'polo', ''))) NOT IN ('ativo', 'passivo') THEN
      RAISE EXCEPTION 'Polo inválido (use ativo ou passivo)';
    ELSE
      v_polo_final := trim(lower(COALESCE(p_payload->>'polo', '')))::varchar(10);
    END IF;
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

  -- BB-10: polo deixa de ser obrigatório em contencioso.
  -- Se fornecido com valor, continua sendo validado contra ('ativo','passivo').
  -- Se não fornecido (p_payload sem chave 'polo'), mantém o valor atual do caso.
  IF v_natureza <> 'contencioso' THEN
    v_polo_final := NULL;
  ELSE
    IF p_payload ? 'polo' THEN
      IF NULLIF(trim(lower(COALESCE(p_payload->>'polo', ''))), '') IS NULL THEN
        v_polo_final := NULL;
      ELSIF trim(lower(COALESCE(p_payload->>'polo', ''))) NOT IN ('ativo', 'passivo') THEN
        RAISE EXCEPTION 'Polo inválido (use ativo ou passivo)';
      ELSE
        v_polo_final := trim(lower(COALESCE(p_payload->>'polo', '')))::varchar(10);
      END IF;
    ELSE
      v_polo_final := v_old_polo;
      IF v_polo_final IS NOT NULL THEN
        v_polo_final := lower(v_polo_final::text)::varchar(10);
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
