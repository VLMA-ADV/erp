-- Transferir um caso para outro contrato (pedido do cliente).
-- + RPC de listagem de contratos para o seletor de destino.

CREATE OR REPLACE FUNCTION public.get_contratos_lista(p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, contracts, crm, core AS $fn$
DECLARE v_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_tenant FROM core.tenant_users WHERE user_id=p_user_id AND status='ativo' LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;
  RETURN COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.cliente_nome, x.numero) FROM (
     SELECT ct.id, ct.numero, ct.status::text AS status, COALESCE(cli.nome,'Sem cliente') AS cliente_nome
     FROM contracts.contratos ct
     LEFT JOIN crm.clientes cli ON cli.id=ct.cliente_id
     WHERE ct.tenant_id=v_tenant
  ) x), '[]'::jsonb);
END;
$fn$;
GRANT EXECUTE ON FUNCTION public.get_contratos_lista(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.transferir_caso(p_user_id uuid, p_caso_id uuid, p_novo_contrato_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, contracts, core AS $fn$
DECLARE v_tenant uuid; v_old uuid;
BEGIN
  SELECT tenant_id INTO v_tenant FROM core.tenant_users WHERE user_id=p_user_id AND status='ativo' LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;

  SELECT contrato_id INTO v_old FROM contracts.casos WHERE id=p_caso_id AND tenant_id=v_tenant;
  IF v_old IS NULL THEN RAISE EXCEPTION 'Caso não encontrado'; END IF;
  IF NOT EXISTS (SELECT 1 FROM contracts.contratos WHERE id=p_novo_contrato_id AND tenant_id=v_tenant) THEN
    RAISE EXCEPTION 'Contrato de destino inválido';
  END IF;
  IF p_novo_contrato_id = v_old THEN
    RAISE EXCEPTION 'O caso já pertence a este contrato';
  END IF;

  UPDATE contracts.casos SET contrato_id=p_novo_contrato_id WHERE id=p_caso_id AND tenant_id=v_tenant;
  RETURN jsonb_build_object('caso_id', p_caso_id, 'contrato_anterior', v_old, 'novo_contrato', p_novo_contrato_id);
END;
$fn$;
GRANT EXECUTE ON FUNCTION public.transferir_caso(uuid,uuid,uuid) TO authenticated;
