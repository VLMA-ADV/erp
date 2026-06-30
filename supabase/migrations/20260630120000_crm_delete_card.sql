-- CRM: exclusão (soft delete) de card do pipeline
-- Mantém o registro (ativo = false); a listagem já filtra ativo = true.
CREATE OR REPLACE FUNCTION public.delete_crm_pipeline_card(p_user_id uuid, p_card_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
AS $function$
DECLARE v_tenant_id uuid;
BEGIN
  SELECT tenant_id INTO v_tenant_id FROM core.tenant_users tu WHERE tu.user_id = p_user_id AND tu.status = 'ativo' LIMIT 1;
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;

  UPDATE crm.pipeline_cards c SET ativo = false, updated_at = now(), updated_by = p_user_id
  WHERE c.id = p_card_id AND c.tenant_id = v_tenant_id AND c.ativo = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Card não encontrado'; END IF;

  RETURN jsonb_build_object('id', p_card_id, 'ativo', false);
END;
$function$;
