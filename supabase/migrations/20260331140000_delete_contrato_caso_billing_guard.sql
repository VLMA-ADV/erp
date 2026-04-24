-- Permite excluir contrato/caso em qualquer status; bloqueia se houver faturamento emitido
-- (itens faturados / nota gerada, ou registro em finance.billing_notes).

CREATE OR REPLACE FUNCTION public.delete_contrato_draft(p_user_id uuid, p_contrato_id uuid)
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

  IF NOT EXISTS (
    SELECT 1 FROM contracts.contratos c
    WHERE c.id = p_contrato_id AND c.tenant_id = v_tenant_id
  ) THEN
    RAISE EXCEPTION 'Contrato não encontrado';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM finance.billing_items bi
    WHERE bi.tenant_id = v_tenant_id
      AND bi.contrato_id = p_contrato_id
      AND bi.status IN ('faturado', 'nota_gerada')
  ) OR EXISTS (
    SELECT 1
    FROM finance.billing_notes bn
    WHERE bn.tenant_id = v_tenant_id
      AND bn.contrato_id = p_contrato_id
  ) THEN
    RAISE EXCEPTION 'Contrato possui faturamento emitido e não pode ser excluído';
  END IF;

  DELETE FROM finance.billing_items bi
  WHERE bi.tenant_id = v_tenant_id
    AND bi.contrato_id = p_contrato_id;

  DELETE FROM contracts.contratos c
  WHERE c.id = p_contrato_id
    AND c.tenant_id = v_tenant_id;

  RETURN jsonb_build_object('id', p_contrato_id, 'deleted', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_caso_draft(p_user_id uuid, p_caso_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_tenant_id uuid;
BEGIN
  SELECT tenant_id INTO v_tenant_id
  FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id
    AND tu.status = 'ativo'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não associado a tenant';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM contracts.casos cs
    WHERE cs.id = p_caso_id AND cs.tenant_id = v_tenant_id
  ) THEN
    RAISE EXCEPTION 'Caso não encontrado';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM finance.billing_items bi
    WHERE bi.tenant_id = v_tenant_id
      AND bi.caso_id = p_caso_id
      AND bi.status IN ('faturado', 'nota_gerada')
  ) OR EXISTS (
    SELECT 1
    FROM finance.billing_notes bn
    WHERE bn.tenant_id = v_tenant_id
      AND bn.caso_id = p_caso_id
  ) THEN
    RAISE EXCEPTION 'Caso possui faturamento emitido e não pode ser excluído';
  END IF;

  DELETE FROM finance.billing_items bi
  WHERE bi.tenant_id = v_tenant_id
    AND bi.caso_id = p_caso_id;

  DELETE FROM contracts.casos cs
  WHERE cs.id = p_caso_id
    AND cs.tenant_id = v_tenant_id;

  RETURN jsonb_build_object(
    'id', p_caso_id,
    'deleted', true
  );
END;
$function$;
