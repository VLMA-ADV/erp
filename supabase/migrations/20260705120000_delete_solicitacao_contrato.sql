-- Solicitações de contrato: permitir excluir (não existia delete — cliente reportou
-- "não consigo excluir as antigas"). FKs de anexos e mensagens são ON DELETE CASCADE;
-- pipeline_cards é SET NULL. Delete tenant-scoped, espelhando o create (checa tenant).

CREATE OR REPLACE FUNCTION public.delete_solicitacao_contrato(p_user_id uuid, p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, core, contracts AS $fn$
DECLARE v_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_tenant FROM core.tenant_users WHERE user_id = p_user_id AND status = 'ativo' LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;

  IF NOT EXISTS (SELECT 1 FROM contracts.solicitacoes_contrato WHERE id = p_id AND tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Solicitação não encontrada';
  END IF;

  DELETE FROM contracts.solicitacoes_contrato WHERE id = p_id AND tenant_id = v_tenant;
  RETURN jsonb_build_object('deleted', p_id);
END;
$fn$;
GRANT EXECUTE ON FUNCTION public.delete_solicitacao_contrato(uuid, uuid) TO authenticated;
