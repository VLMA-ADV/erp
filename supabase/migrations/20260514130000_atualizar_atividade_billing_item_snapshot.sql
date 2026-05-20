-- Daily 2026-05-14 (Filipe/Jéssica): permitir edição emergencial do texto
-- da Atividade no snapshot de finance.billing_items pelo Fluxo de Faturamento,
-- sem voltar para revisão. Substitui apenas o campo `atividade` de um row
-- específico do array `timesheet_itens_revisao` localizado pelo `id` do
-- timesheet original.
--
-- SECURITY DEFINER para bypass de RLS; permission check via get_user_permissions
-- exigindo finance.faturamento.review/approve/* ou finance.*/*.

CREATE OR REPLACE FUNCTION public.atualizar_atividade_billing_item_snapshot(
  p_user_id uuid,
  p_billing_item_id uuid,
  p_timesheet_id uuid,
  p_atividade text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, core, finance
AS $$
DECLARE
  v_tenant_id uuid;
  v_has_permission boolean;
  v_idx int;
BEGIN
  SELECT tenant_id INTO v_tenant_id
  FROM core.tenant_users
  WHERE user_id = p_user_id AND status = 'ativo'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Usuário sem tenant ativo';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.get_user_permissions(p_user_id) p
    WHERE p.permission_key IN (
      'finance.faturamento.review',
      'finance.faturamento.approve',
      'finance.faturamento.*',
      'finance.*',
      '*'
    )
  ) INTO v_has_permission;

  IF NOT v_has_permission THEN
    RAISE EXCEPTION 'Permissão negada para editar atividade do fluxo de faturamento';
  END IF;

  SELECT (idx - 1) INTO v_idx
  FROM finance.billing_items bi,
       jsonb_array_elements(bi.snapshot->'timesheet_itens_revisao') WITH ORDINALITY arr(elem, idx)
  WHERE bi.id = p_billing_item_id
    AND bi.tenant_id = v_tenant_id
    AND (elem->>'id')::uuid = p_timesheet_id;

  IF v_idx IS NULL THEN
    RAISE EXCEPTION 'Lançamento não encontrado no snapshot do item';
  END IF;

  UPDATE finance.billing_items
  SET
    snapshot = jsonb_set(
      snapshot,
      ARRAY['timesheet_itens_revisao', v_idx::text, 'atividade'],
      to_jsonb(p_atividade),
      true
    ),
    updated_at = now(),
    updated_by = p_user_id
  WHERE id = p_billing_item_id
    AND tenant_id = v_tenant_id;

  RETURN jsonb_build_object(
    'ok', true,
    'billing_item_id', p_billing_item_id,
    'timesheet_id', p_timesheet_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.atualizar_atividade_billing_item_snapshot(uuid, uuid, uuid, text) TO authenticated;
