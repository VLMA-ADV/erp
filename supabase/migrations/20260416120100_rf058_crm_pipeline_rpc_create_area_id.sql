-- RF-058: create_crm_pipeline_card — area_id (people.areas).
-- Depende de: 20260416120000_rf058_crm_pipeline_area_id.sql

CREATE OR REPLACE FUNCTION public.create_crm_pipeline_card(p_user_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_tenant_id uuid;
  v_id uuid;
  v_cliente_id uuid;
  v_servico_id uuid;
  v_produto_id uuid;
  v_responsavel_id uuid;
  v_area_id uuid;
  v_etapa varchar;
  v_ordem integer;
  v_valor numeric(14,2);
  v_item jsonb;
BEGIN
  SELECT tenant_id INTO v_tenant_id
  FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id
    AND tu.status = 'ativo'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não associado a tenant';
  END IF;

  IF NULLIF(p_payload->>'cliente_id', '') IS NULL THEN
    RAISE EXCEPTION 'Cliente é obrigatório';
  END IF;

  v_cliente_id := (p_payload->>'cliente_id')::uuid;

  IF NOT EXISTS (
    SELECT 1
    FROM crm.clientes c
    WHERE c.id = v_cliente_id
      AND c.tenant_id = v_tenant_id
  ) THEN
    RAISE EXCEPTION 'Cliente não encontrado';
  END IF;

  v_servico_id := NULLIF(p_payload->>'servico_id', '')::uuid;
  IF v_servico_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM operations.categorias_servico s
      WHERE s.id = v_servico_id
        AND s.tenant_id = v_tenant_id
    ) THEN
      RAISE EXCEPTION 'Serviço não encontrado';
    END IF;
  END IF;

  v_produto_id := NULLIF(p_payload->>'produto_id', '')::uuid;
  IF v_produto_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM contracts.produtos p
      WHERE p.id = v_produto_id
        AND p.tenant_id = v_tenant_id
    ) THEN
      RAISE EXCEPTION 'Produto não encontrado';
    END IF;
  END IF;

  v_responsavel_id := NULLIF(p_payload->>'responsavel_interno_id', '')::uuid;
  IF v_responsavel_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM people.colaboradores col
      WHERE col.id = v_responsavel_id
        AND col.tenant_id = v_tenant_id
    ) THEN
      RAISE EXCEPTION 'Responsável interno não encontrado';
    END IF;
  END IF;

  v_area_id := NULLIF(p_payload->>'area_id', '')::uuid;
  IF v_area_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM people.areas a
      WHERE a.id = v_area_id
        AND a.tenant_id = v_tenant_id
        AND a.ativo = true
    ) THEN
      RAISE EXCEPTION 'Área não encontrada';
    END IF;
  END IF;

  v_etapa := lower(COALESCE(NULLIF(p_payload->>'etapa', ''), 'prospeccao'));
  IF v_etapa NOT IN ('prospeccao', 'proposta_solicitada', 'proposta_enviada', 'conversao', 'negada', 'suspensa') THEN
    RAISE EXCEPTION 'Etapa inválida';
  END IF;

  v_valor := COALESCE(NULLIF(replace(p_payload->>'valor', ',', '.'), '')::numeric, 0);
  IF v_valor < 0 THEN
    RAISE EXCEPTION 'Valor inválido';
  END IF;

  v_ordem := NULLIF(p_payload->>'ordem', '')::integer;
  IF v_ordem IS NULL OR v_ordem < 1 THEN
    SELECT COALESCE(MAX(c.ordem), 0) + 1
      INTO v_ordem
    FROM crm.pipeline_cards c
    WHERE c.tenant_id = v_tenant_id
      AND c.etapa = v_etapa;
  END IF;

  INSERT INTO crm.pipeline_cards (
    tenant_id,
    cliente_id,
    servico_id,
    produto_id,
    valor,
    responsavel_interno_id,
    area_id,
    observacoes,
    etapa,
    ordem,
    created_by,
    updated_by
  ) VALUES (
    v_tenant_id,
    v_cliente_id,
    v_servico_id,
    v_produto_id,
    v_valor,
    v_responsavel_id,
    v_area_id,
    COALESCE(p_payload->>'observacoes', ''),
    v_etapa,
    v_ordem,
    p_user_id,
    p_user_id
  ) RETURNING id INTO v_id;

  FOR v_item IN
    SELECT value FROM jsonb_array_elements(COALESCE(p_payload->'anexos', '[]'::jsonb))
  LOOP
    IF COALESCE(NULLIF(trim(v_item->>'arquivo_base64'), ''), '') = '' THEN
      CONTINUE;
    END IF;

    INSERT INTO crm.pipeline_card_anexos (
      tenant_id,
      card_id,
      nome,
      arquivo_nome,
      mime_type,
      tamanho_bytes,
      arquivo,
      created_by
    ) VALUES (
      v_tenant_id,
      v_id,
      COALESCE(NULLIF(trim(v_item->>'nome'), ''), 'Anexo'),
      COALESCE(NULLIF(trim(v_item->>'arquivo_nome'), ''), 'anexo.bin'),
      NULLIF(v_item->>'mime_type', ''),
      NULLIF(v_item->>'tamanho_bytes', '')::bigint,
      decode(v_item->>'arquivo_base64', 'base64'),
      p_user_id
    );
  END LOOP;

  RETURN jsonb_build_object('id', v_id);
END;
$function$
