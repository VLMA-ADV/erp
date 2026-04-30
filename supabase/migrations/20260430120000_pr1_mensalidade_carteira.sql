-- PR1 Mensalidade de Carteira (daily Filipe 28/04/2026)
--
-- Feature: upload de CSV de processos + valor mensal único por carteira.
-- Modelo: 1 caso MATRIZ + N casos FILHOS no mesmo contrato, todos com
-- regra_cobranca='mensalidade_carteira', ligados por nova coluna FK
-- self-referencing parte_de_carteira_id. RPC create_caso detecta matriz
-- (regra_cobranca='mensalidade_carteira' AND parte_de_carteira_id IS NULL)
-- e expande filhos via LOOP em transação atômica. Filhos herdam quase
-- tudo do matriz exceto nome (=identificador) e observação (=numero_processo).
--
-- Aplicado em DEV via Cursor MCP em 2026-04-30 como 5 migrations separadas:
--   1. 20260430_pr1_mensalidade_carteira_chunk1_casos_fk_check_index
--   2. 20260430_pr1_mensalidade_carteira_chunk2_create_caso_expand_filhos
--   3. 20260430_pr1_mensalidade_carteira_chunk3_update_caso_bloqueios_filho
--   4. 20260430_pr1_mensalidade_carteira_chunk4_get_contrato_carteira_fields
--   5. 20260430_pr1_mensalidade_carteira_chunk5_start_faturamento_flow_carteira
--
-- SHA-256 das functions pós-aplicação (audit):
--   create_caso:            be4206a9324682ba471fb530098f198f3ca5c9f4ef5fd090977d3e07bed4e401
--   update_caso:            1f390c9e3baa1a7d2ef81d79e1a2ac8f0cce77034f937b251179b0b3a132ba26
--   get_contrato:           6737863f39cf71c993a3bbb0c175c1eae028b3622eba5d6d056cf767b098f4b1
--   start_faturamento_flow: 1f6c25964e292f7a9d3ab275cdea37132c180626a21081806b1b29376b861423
--
-- Smokes verdes em DEV (BEGIN/ROLLBACK isolado, contrato 91ef86d0-..., user 25cdd81d-...):
--   1. create matriz Carteira XPTO + 3 processos -> 1 matriz + 3 filhos
--   2. get_contrato retorna parte_de_carteira_id + processos_carteira_count
--   3. update_caso(filho, regra_cobranca=mensal) rejeitado com mensagem clara
--   4. update_caso(filho, nome=...) permitido e persistido
--   5. CHECK constraint rejeita regra_cobranca='foo_invalido' (check_violation)
--   6. start_faturamento_flow período março/2026 gera 1 billing_item de R$30.000,00
--      na matriz e 0 nos filhos (caso_id ANY(filhos)).
--
-- Idempotente: ALTER ... IF NOT EXISTS, DROP CONSTRAINT IF EXISTS antes de
-- ADD CHECK, CREATE OR REPLACE FUNCTION. Replay seguro via supabase db push.

-- ============================================================
-- CHUNK 1 — ALTER TABLE + CHECK + INDEX
-- ============================================================

ALTER TABLE contracts.casos
  ADD COLUMN IF NOT EXISTS parte_de_carteira_id uuid NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'casos_parte_de_carteira_id_fkey'
      AND conrelid = 'contracts.casos'::regclass
  ) THEN
    ALTER TABLE contracts.casos
      ADD CONSTRAINT casos_parte_de_carteira_id_fkey
      FOREIGN KEY (parte_de_carteira_id)
      REFERENCES contracts.casos(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_casos_parte_de_carteira_id
  ON contracts.casos(parte_de_carteira_id)
  WHERE parte_de_carteira_id IS NOT NULL;

COMMENT ON COLUMN contracts.casos.parte_de_carteira_id IS
  'UUID do caso matriz quando este caso é filho de uma carteira (regra_cobranca=mensalidade_carteira). NULL para casos standalone ou matrizes.';

ALTER TABLE contracts.casos DROP CONSTRAINT IF EXISTS casos_regra_cobranca_check;

ALTER TABLE contracts.casos ADD CONSTRAINT casos_regra_cobranca_check
  CHECK (regra_cobranca IS NULL OR regra_cobranca IN (
    'hora',
    'hora_com_cap',
    'mensal',
    'mensalidade_processo',
    'salario_minimo',
    'mensalidade_carteira',
    'projeto',
    'projeto_parcelado',
    'exito'
  ));

-- ============================================================
-- CHUNK 2 — CREATE OR REPLACE create_caso
-- ============================================================

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
  elem jsonb;
  -- Mensalidade de Carteira
  v_eh_carteira_matriz boolean := false;
  v_processos_carteira jsonb;
  v_processo jsonb;
  v_regra_cobranca_text text;
  v_parte_de_carteira_id uuid;
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
      SELECT 1 FROM people.colaboradores col
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
    -- BB-relax-sm: validação removida da RPC. Frontend mostra aviso visual.
    NULL;
  END IF;

  v_regra_principal := public.pick_regra_financeira_principal(v_regras_financeiras);

  v_natureza := lower(trim(COALESCE(
    NULLIF(v_regra_principal->'regra_cobranca_config'->>'natureza_caso', ''),
    NULLIF(v_regra_principal->>'natureza_caso', ''),
    NULLIF(p_payload->'regra_cobranca_config'->>'natureza_caso', ''),
    NULLIF(p_payload->>'natureza_caso', ''),
    ''
  )));

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

  -- DELTA Mensalidade de Carteira: detectar se é matriz
  v_regra_cobranca_text := COALESCE(NULLIF(v_regra_principal->>'regra_cobranca', ''), NULLIF(p_payload->>'regra_cobranca', ''));
  v_parte_de_carteira_id := NULLIF(p_payload->>'parte_de_carteira_id', '')::uuid;
  v_eh_carteira_matriz := (
    v_regra_cobranca_text = 'mensalidade_carteira'
    AND v_parte_de_carteira_id IS NULL
  );
  IF v_eh_carteira_matriz THEN
    v_processos_carteira := COALESCE(
      v_regra_principal->'regra_cobranca_config'->'processos_carteira',
      p_payload->'regra_cobranca_config'->'processos_carteira',
      '[]'::jsonb
    );
  END IF;

  INSERT INTO contracts.casos (
    tenant_id, contrato_id, parte_de_carteira_id, nome, observacao, servico_id, produto_id, responsavel_id,
    moeda, tipo_cobranca_documento, data_inicio_faturamento, dia_inicio_faturamento,
    polo, pagamento_dia_mes, inicio_vigencia, periodo_reajuste,
    data_proximo_reajuste, data_ultimo_reajuste, indice_reajuste,
    regra_cobranca, regra_cobranca_config, regras_financeiras,
    centro_custo_rateio, pagadores_servico, despesas_config, pagadores_despesa,
    timesheet_config, indicacao_config, status, ativo, created_by, updated_by
  ) VALUES (
    v_tenant_id, p_contrato_id, v_parte_de_carteira_id, p_payload->>'nome',
    NULLIF(p_payload->>'observacao', ''),
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

  -- DELTA Mensalidade de Carteira: expandir filhos se for matriz
  IF v_eh_carteira_matriz
     AND v_processos_carteira IS NOT NULL
     AND jsonb_typeof(v_processos_carteira) = 'array'
     AND jsonb_array_length(v_processos_carteira) > 0 THEN
    FOR v_processo IN SELECT value FROM jsonb_array_elements(v_processos_carteira)
    LOOP
      INSERT INTO contracts.casos (
        tenant_id, contrato_id, parte_de_carteira_id, nome, observacao, servico_id, produto_id, responsavel_id,
        moeda, tipo_cobranca_documento, data_inicio_faturamento, dia_inicio_faturamento,
        polo, pagamento_dia_mes, inicio_vigencia, periodo_reajuste,
        data_proximo_reajuste, data_ultimo_reajuste, indice_reajuste,
        regra_cobranca, regra_cobranca_config, regras_financeiras,
        centro_custo_rateio, pagadores_servico, despesas_config, pagadores_despesa,
        timesheet_config, indicacao_config, status, ativo, created_by, updated_by
      )
      SELECT
        cs.tenant_id, cs.contrato_id, cs.id,
        COALESCE(NULLIF(v_processo->>'identificador', ''), 'Processo sem identificador'),
        NULLIF(v_processo->>'numero_processo', ''),
        cs.servico_id, cs.produto_id, cs.responsavel_id,
        cs.moeda, cs.tipo_cobranca_documento, cs.data_inicio_faturamento, cs.dia_inicio_faturamento,
        cs.polo, cs.pagamento_dia_mes, cs.inicio_vigencia, cs.periodo_reajuste,
        cs.data_proximo_reajuste, cs.data_ultimo_reajuste, cs.indice_reajuste,
        'mensalidade_carteira',
        jsonb_build_object(
          'numero_processo', v_processo->>'numero_processo',
          'identificador', v_processo->>'identificador'
        ),
        '[]'::jsonb,
        cs.centro_custo_rateio, cs.pagadores_servico, cs.despesas_config, cs.pagadores_despesa,
        cs.timesheet_config, cs.indicacao_config, cs.status, cs.ativo, p_user_id, p_user_id
      FROM contracts.casos cs WHERE cs.id = v_caso_id;
    END LOOP;
  END IF;

  UPDATE contracts.contratos c
  SET status = 'ativo', updated_at = now(), updated_by = p_user_id
  WHERE c.id = p_contrato_id
    AND c.tenant_id = v_tenant_id
    AND c.status = 'rascunho';

  RETURN jsonb_build_object('id', v_caso_id, 'numero', v_caso_numero);
END;
$function$;

-- ============================================================
-- CHUNK 3 — CREATE OR REPLACE update_caso
-- ============================================================

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
  v_old_parte_de_carteira_id uuid;
  v_eh_filho_carteira boolean;
  v_natureza text;
  v_polo_final varchar(10);
  elem jsonb;
BEGIN
  SELECT tenant_id INTO v_tenant_id
  FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id AND tu.status = 'ativo'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não associado a tenant';
  END IF;

  SELECT cs.regras_financeiras, cs.polo, cs.parte_de_carteira_id
    INTO v_old_regras, v_old_polo, v_old_parte_de_carteira_id
  FROM contracts.casos cs
  WHERE cs.id = p_caso_id AND cs.tenant_id = v_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Caso não encontrado';
  END IF;

  v_eh_filho_carteira := (v_old_parte_de_carteira_id IS NOT NULL);

  -- DELTA Mensalidade de Carteira: bloquear campos read-only no filho
  IF v_eh_filho_carteira THEN
    IF p_payload ? 'regra_cobranca'
       AND NULLIF(p_payload->>'regra_cobranca', '') IS NOT NULL
       AND NULLIF(p_payload->>'regra_cobranca', '') <> 'mensalidade_carteira' THEN
      RAISE EXCEPTION 'Caso pertence a uma carteira; regra_cobranca é definida pela matriz';
    END IF;
    IF p_payload ? 'regra_cobranca_config' AND p_payload->'regra_cobranca_config' IS NOT NULL THEN
      IF p_payload->'regra_cobranca_config' ? 'valor_mensal_carteira'
         OR p_payload->'regra_cobranca_config' ? 'processos_carteira' THEN
        RAISE EXCEPTION 'Caso pertence a uma carteira; valor_mensal_carteira e processos_carteira são definidos na matriz';
      END IF;
    END IF;
    IF p_payload ? 'regras_financeiras'
       AND jsonb_typeof(p_payload->'regras_financeiras') = 'array'
       AND jsonb_array_length(p_payload->'regras_financeiras') > 0 THEN
      RAISE EXCEPTION 'Caso pertence a uma carteira; regras financeiras são definidas pela matriz';
    END IF;
    IF p_payload ? 'dia_inicio_faturamento'
       AND NULLIF(p_payload->>'dia_inicio_faturamento', '') IS NOT NULL THEN
      RAISE EXCEPTION 'Caso pertence a uma carteira; dia_inicio_faturamento é definido pela matriz';
    END IF;
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
      IF v_aprovador_id IS NULL THEN CONTINUE; END IF;
      IF NOT EXISTS (
        SELECT 1 FROM people.colaboradores col
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
    -- BB-relax-sm: validação removida da RPC. Frontend mostra aviso visual.
    NULL;
  END IF;

  v_regra_principal := public.pick_regra_financeira_principal(v_regras_financeiras);

  v_natureza := lower(trim(COALESCE(
    NULLIF(v_regra_principal->'regra_cobranca_config'->>'natureza_caso', ''),
    NULLIF(v_regra_principal->>'natureza_caso', ''),
    NULLIF(p_payload->'regra_cobranca_config'->>'natureza_caso', ''),
    NULLIF(p_payload->>'natureza_caso', ''),
    ''
  )));

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
    observacao = CASE
      WHEN p_payload ? 'observacao' THEN NULLIF(p_payload->>'observacao', '')
      ELSE cs.observacao
    END,
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

-- ============================================================
-- CHUNK 4 — CREATE OR REPLACE get_contrato
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_contrato(p_user_id uuid, p_contrato_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_tenant_id uuid;
  v_result jsonb;
BEGIN
  SELECT tenant_id INTO v_tenant_id
  FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id AND tu.status = 'ativo'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não associado a tenant';
  END IF;

  SELECT jsonb_build_object(
    'contrato', jsonb_build_object(
      'id', c.id,
      'numero', c.numero,
      'cliente_id', c.cliente_id,
      'cliente_nome', cli.nome,
      'nome_contrato', c.nome_contrato,
      'regime_fiscal', c.regime_fiscal,
      'forma_entrada', c.forma_entrada,
      'responsavel_prospeccao_id', c.responsavel_prospeccao_id,
      'canal_prospeccao', c.canal_prospeccao,
      'grupo_imposto_id', c.grupo_imposto_id,
      'grupo_imposto_nome', gi.nome,
      'servico_id', c.servico_id,
      'produto_id', c.produto_id,
      'status', c.status,
      'created_at', c.created_at,
      'updated_at', c.updated_at
    ),
    'anexos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', a.id,
        'nome', a.nome,
        'arquivo_nome', a.arquivo_nome,
        'mime_type', a.mime_type,
        'tamanho_bytes', a.tamanho_bytes,
        'created_at', a.created_at
      ) ORDER BY a.created_at DESC)
      FROM contracts.contrato_anexos a
      WHERE a.contrato_id = c.id
    ), '[]'::jsonb),
    'casos', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', cs.id,
          'numero', cs.numero,
          'parte_de_carteira_id', cs.parte_de_carteira_id,
          'processos_carteira_count', (
            SELECT COUNT(*) FROM contracts.casos f WHERE f.parte_de_carteira_id = cs.id
          ),
          'polo', cs.polo,
          'nome', cs.nome,
          'observacao', cs.observacao,
          'servico_id', cs.servico_id,
          'servico_nome', srv.nome,
          'produto_id', cs.produto_id,
          'responsavel_id', cs.responsavel_id,
          'moeda', cs.moeda,
          'tipo_cobranca_documento', cs.tipo_cobranca_documento,
          'data_inicio_faturamento', cs.data_inicio_faturamento,
          'dia_inicio_faturamento', COALESCE(cs.dia_inicio_faturamento, EXTRACT(DAY FROM cs.data_inicio_faturamento)::integer),
          'pagamento_dia_mes', cs.pagamento_dia_mes,
          'inicio_vigencia', cs.inicio_vigencia,
          'periodo_reajuste', cs.periodo_reajuste,
          'data_proximo_reajuste', cs.data_proximo_reajuste,
          'data_ultimo_reajuste', cs.data_ultimo_reajuste,
          'indice_reajuste', cs.indice_reajuste,
          'regra_cobranca', cs.regra_cobranca,
          'regra_cobranca_config', cs.regra_cobranca_config,
          'regras_financeiras', COALESCE(cs.regras_financeiras, '[]'::jsonb),
          'centro_custo_rateio', cs.centro_custo_rateio,
          'pagadores_servico', cs.pagadores_servico,
          'despesas_config', cs.despesas_config,
          'pagadores_despesa', cs.pagadores_despesa,
          'timesheet_config', cs.timesheet_config,
          'indicacao_config', cs.indicacao_config,
          'status', cs.status,
          'ativo', (cs.status <> 'inativo'),
          'anexos', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'id', ca.id,
              'nome', ca.nome,
              'arquivo_nome', ca.arquivo_nome,
              'mime_type', ca.mime_type,
              'tamanho_bytes', ca.tamanho_bytes,
              'created_at', ca.created_at
            ) ORDER BY ca.created_at DESC)
            FROM contracts.caso_anexos ca
            WHERE ca.caso_id = cs.id
          ), '[]'::jsonb)
        )
        ORDER BY cs.created_at DESC
      )
      FROM contracts.casos cs
      LEFT JOIN operations.categorias_servico srv ON srv.id = cs.servico_id
      WHERE cs.contrato_id = c.id
    ), '[]'::jsonb)
  ) INTO v_result
  FROM contracts.contratos c
  JOIN crm.clientes cli ON cli.id = c.cliente_id
  LEFT JOIN contracts.grupos_impostos gi ON gi.id = c.grupo_imposto_id AND gi.tenant_id = c.tenant_id
  WHERE c.id = p_contrato_id AND c.tenant_id = v_tenant_id;

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'Contrato não encontrado';
  END IF;

  RETURN v_result;
END;
$function$;

-- ============================================================
-- CHUNK 5 — CREATE OR REPLACE start_faturamento_flow
-- ============================================================
-- 3 deltas aditivos:
--  (a) eligible_timesheet ganha "AND cs.parte_de_carteira_id IS NULL"
--      -> filhos não geram billing_item de timesheet
--  (b) eligible_rules_source ganha "AND cs.parte_de_carteira_id IS NULL"
--      -> filhos não geram billing_item de regra
--  (c) eligible_rules_calc ganha branch "WHEN ers.regra_cobranca = 'mensalidade_carteira'"
--      (mesma lógica de mensal/mensalidade_processo, mas usando
--      cfg->>'valor_mensal_carteira') + 'mensalidade_carteira' adicionado
--      ao IN(...) do WHERE final.
-- Typos preservados bit-a-bit (SELECt count(*) minúsculo em 3 lugares
-- após esta migration) — diff cosmético sem benefício é ruído.

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
          COALESCE(NULLIF(ers.rule_item->>'quantidade_sm', '')::numeric, 0)
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
