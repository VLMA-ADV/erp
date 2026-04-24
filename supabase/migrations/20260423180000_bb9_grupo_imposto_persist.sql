-- BB-9 — grupo_imposto_id agora é persistido em contratos.
-- Root cause (confirmado via pg_get_functiondef em 2026-04-23):
-- public.create_contrato e public.update_contrato NÃO incluíam
-- grupo_imposto_id no INSERT nem no SET. Frontend já enviava
-- corretamente; a RPC descartava silenciosamente. Resultado: 100%
-- dos 10 últimos contratos com grupo_imposto_id NULL em DEV.
--
-- Fix: adiciona grupo_imposto_id às 2 RPCs.
--   - create_contrato: +1 coluna no INSERT após produto_id.
--   - update_contrato: +1 linha no SET após produto_id.
-- Nenhuma mudança de assinatura (BB-10 lesson: CREATE OR REPLACE
-- só substitui quando assinatura coincide; senão cria overload).
-- FK contratos_grupo_imposto_id_fkey existe e aceita NULL
-- (ON DELETE SET NULL). Coluna is_nullable = YES.
--
-- Idempotente. Corpo preservado bit-a-bit do deployado em DEV.

CREATE OR REPLACE FUNCTION public.create_contrato(p_user_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_tenant_id uuid;
  v_contrato_id uuid;
  v_contrato_numero bigint;
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
    NULLIF(p_payload->>'servico_id', '')::uuid,
    NULLIF(p_payload->>'produto_id', '')::uuid,
    NULLIF(p_payload->>'grupo_imposto_id', '')::uuid,
    v_initial_status,
    p_user_id,
    p_user_id
  ) RETURNING id, numero INTO v_contrato_id, v_contrato_numero;

  IF v_casos_count > 0 THEN
    FOR v_caso IN
      SELECT value FROM jsonb_array_elements(COALESCE(p_payload->'casos', '[]'::jsonb))
    LOOP
      PERFORM public.create_caso(p_user_id, v_contrato_id, v_caso);
    END LOOP;
  END IF;

  RETURN jsonb_build_object('id', v_contrato_id, 'numero', v_contrato_numero, 'status', v_initial_status);
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
