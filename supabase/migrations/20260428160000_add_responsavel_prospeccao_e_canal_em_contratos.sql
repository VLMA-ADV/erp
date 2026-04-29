-- Bug Item 1 (Filipe daily 28/04): responsavel_prospeccao_id e canal_prospeccao
-- não persistiam em contracts.contratos. Causa: colunas inexistentes + 3 RPCs
-- (create_contrato/update_contrato/get_contrato) sem suporte aos campos.
-- Frontend (contrato-form.tsx) já enviava os 2 campos no payload — silent loss.
-- Aplicado em DEV via Cursor MCP em 2026-04-28; SHA-256 reportado:
-- 890c8e90eb2c185a25f112780b92bdfcf29841607f6c0cb34ee5eb5e2ed90257
-- Smoke verde: tabela e RPC get_contrato retornaram os mesmos valores.

ALTER TABLE contracts.contratos
  ADD COLUMN IF NOT EXISTS responsavel_prospeccao_id uuid NULL;

ALTER TABLE contracts.contratos
  ADD COLUMN IF NOT EXISTS canal_prospeccao varchar(100) NULL;

COMMENT ON COLUMN contracts.contratos.responsavel_prospeccao_id IS
  'UUID do colaborador responsável quando forma_entrada = prospeccao';
COMMENT ON COLUMN contracts.contratos.canal_prospeccao IS
  'Canal de prospecção quando forma_entrada = prospeccao';

CREATE OR REPLACE FUNCTION public.create_contrato(p_user_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_tenant_id uuid;
  v_contrato_id uuid;
  v_contrato_numero bigint;
  v_numero_sequencial integer;
  v_caso jsonb;
  v_casos_count int;
  v_initial_status varchar;
BEGIN
  SELECT tenant_id INTO v_tenant_id
  FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id AND tu.status = 'ativo'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não associado a tenant';
  END IF;

  IF COALESCE(trim(p_payload->>'nome_contrato'), '') = '' THEN
    RAISE EXCEPTION 'Nome do contrato é obrigatório';
  END IF;

  IF NULLIF(p_payload->>'cliente_id', '') IS NULL THEN
    RAISE EXCEPTION 'Cliente é obrigatório';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM crm.clientes c
    WHERE c.id = (p_payload->>'cliente_id')::uuid AND c.tenant_id = v_tenant_id
  ) THEN
    RAISE EXCEPTION 'Cliente não encontrado';
  END IF;

  v_casos_count := COALESCE(jsonb_array_length(COALESCE(p_payload->'casos', '[]'::jsonb)), 0);
  v_initial_status := COALESCE(NULLIF(p_payload->>'status', ''), 'rascunho');

  IF v_initial_status NOT IN ('rascunho', 'em_analise', 'ativo', 'encerrado') THEN
    v_initial_status := 'rascunho';
  END IF;

  IF v_casos_count > 0 AND v_initial_status = 'rascunho' THEN
    v_initial_status := 'em_analise';
  END IF;

  INSERT INTO contracts.contratos (
    tenant_id,
    cliente_id,
    nome_contrato,
    regime_fiscal,
    forma_entrada,
    responsavel_prospeccao_id,
    canal_prospeccao,
    servico_id,
    produto_id,
    grupo_imposto_id,
    status,
    created_by,
    updated_by
  ) VALUES (
    v_tenant_id,
    (p_payload->>'cliente_id')::uuid,
    p_payload->>'nome_contrato',
    NULLIF(p_payload->>'regime_fiscal', ''),
    NULLIF(p_payload->>'forma_entrada', ''),
    NULLIF(p_payload->>'responsavel_prospeccao_id', '')::uuid,
    NULLIF(p_payload->>'canal_prospeccao', ''),
    NULLIF(p_payload->>'servico_id', '')::uuid,
    NULLIF(p_payload->>'produto_id', '')::uuid,
    NULLIF(p_payload->>'grupo_imposto_id', '')::uuid,
    v_initial_status,
    p_user_id,
    p_user_id
  ) RETURNING id, numero, numero_sequencial INTO v_contrato_id, v_contrato_numero, v_numero_sequencial;

  IF v_casos_count > 0 THEN
    FOR v_caso IN
      SELECT value FROM jsonb_array_elements(COALESCE(p_payload->'casos', '[]'::jsonb))
    LOOP
      PERFORM public.create_caso(p_user_id, v_contrato_id, v_caso);
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'id', v_contrato_id,
    'numero', v_contrato_numero,
    'numero_sequencial', v_numero_sequencial,
    'status', v_initial_status
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_contrato(p_user_id uuid, p_contrato_id uuid, p_payload jsonb)
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

  UPDATE contracts.contratos c
  SET
    cliente_id = COALESCE(NULLIF(p_payload->>'cliente_id', '')::uuid, c.cliente_id),
    nome_contrato = COALESCE(NULLIF(p_payload->>'nome_contrato', ''), c.nome_contrato),
    regime_fiscal = CASE
      WHEN p_payload ? 'regime_fiscal' THEN NULLIF(p_payload->>'regime_fiscal', '')
      ELSE c.regime_fiscal
    END,
    forma_entrada = CASE
      WHEN p_payload ? 'forma_entrada' THEN NULLIF(p_payload->>'forma_entrada', '')
      ELSE c.forma_entrada
    END,
    responsavel_prospeccao_id = CASE
      WHEN p_payload ? 'responsavel_prospeccao_id' THEN NULLIF(p_payload->>'responsavel_prospeccao_id', '')::uuid
      ELSE c.responsavel_prospeccao_id
    END,
    canal_prospeccao = CASE
      WHEN p_payload ? 'canal_prospeccao' THEN NULLIF(p_payload->>'canal_prospeccao', '')
      ELSE c.canal_prospeccao
    END,
    servico_id = CASE
      WHEN p_payload ? 'servico_id' THEN NULLIF(p_payload->>'servico_id', '')::uuid
      ELSE c.servico_id
    END,
    produto_id = CASE
      WHEN p_payload ? 'produto_id' THEN NULLIF(p_payload->>'produto_id', '')::uuid
      ELSE c.produto_id
    END,
    grupo_imposto_id = CASE
      WHEN p_payload ? 'grupo_imposto_id' THEN NULLIF(p_payload->>'grupo_imposto_id', '')::uuid
      ELSE c.grupo_imposto_id
    END,
    updated_at = now(),
    updated_by = p_user_id
  WHERE c.id = p_contrato_id
    AND c.tenant_id = v_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contrato não encontrado';
  END IF;

  RETURN jsonb_build_object('id', p_contrato_id);
END;
$function$;

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
