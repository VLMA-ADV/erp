-- Ajuste manual do "ano de captação" do cliente (resposta 3b do Filipe).
CREATE OR REPLACE FUNCTION public.set_cliente_ano_captacao(p_cliente_id uuid, p_ano integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'crm', 'core'
AS $function$
DECLARE v_tenant uuid; v_can boolean;
BEGIN
  SELECT tenant_id INTO v_tenant FROM core.tenant_users WHERE user_id = auth.uid() AND status='ativo' LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.get_user_permissions(auth.uid()) p
    WHERE p.permission_key IN ('crm.clientes.write','crm.clientes.*','crm.*','*')
  ) INTO v_can;
  IF NOT v_can THEN RAISE EXCEPTION 'Sem permissão para editar cliente'; END IF;
  IF p_ano IS NOT NULL AND (p_ano < 1990 OR p_ano > 2100) THEN
    RAISE EXCEPTION 'Ano inválido';
  END IF;

  UPDATE crm.clientes SET ano_captacao_override = p_ano, updated_by = auth.uid(), updated_at = now()
  WHERE id = p_cliente_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cliente não encontrado'; END IF;
  RETURN jsonb_build_object('cliente_id', p_cliente_id, 'ano_captacao_override', p_ano);
END;
$function$;
