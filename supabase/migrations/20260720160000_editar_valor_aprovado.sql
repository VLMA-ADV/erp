-- Pedido 20/07 (etapa 3): "o financeiro pode no último momento editar o valor
-- para evitar que seja retornado à etapa anterior". Item aprovado (ainda não
-- faturado) pode ter o valor final ajustado por quem tem manage; fica
-- registrado no histórico e na auditoria.
CREATE OR REPLACE FUNCTION public.editar_valor_aprovado(p_user_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_tenant_id uuid;
  v_item_id uuid;
  v_valor numeric(14,2);
  v_item finance.billing_items%ROWTYPE;
  v_can_manage boolean;
  v_author_name text;
BEGIN
  -- Chamada via PostgREST traz auth.uid(); p_user_id não pode divergir dele
  -- (impede forjar o usuário). Via service role (edge/testes) auth.uid() é null.
  IF auth.uid() IS NOT NULL AND auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'p_user_id não corresponde ao usuário autenticado';
  END IF;

  SELECT tenant_id INTO v_tenant_id
  FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id AND tu.status = 'ativo'
  LIMIT 1;
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.get_user_permissions(p_user_id) p
    WHERE p.permission_key IN ('finance.faturamento.manage', 'finance.faturamento.*', 'finance.*', '*')
  ) INTO v_can_manage;
  IF NOT v_can_manage THEN
    RAISE EXCEPTION 'Sem permissão para editar o valor final (exige gestão de faturamento)';
  END IF;

  v_item_id := NULLIF(p_payload->>'billing_item_id', '')::uuid;
  v_valor := NULLIF(p_payload->>'valor', '')::numeric;
  IF v_item_id IS NULL THEN RAISE EXCEPTION 'billing_item_id é obrigatório'; END IF;
  IF v_valor IS NULL OR v_valor < 0 THEN RAISE EXCEPTION 'Informe um valor válido (>= 0)'; END IF;

  SELECT * INTO v_item FROM finance.billing_items bi
  WHERE bi.id = v_item_id AND bi.tenant_id = v_tenant_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Item de faturamento não encontrado'; END IF;
  IF v_item.status <> 'aprovado' THEN
    RAISE EXCEPTION 'Só é possível ajustar o valor final de itens aprovados (status atual: %)', v_item.status;
  END IF;

  UPDATE finance.billing_items bi
  SET valor_aprovado = v_valor,
      snapshot = COALESCE(bi.snapshot, '{}'::jsonb) || jsonb_build_object(
        'valor_aprovado', v_valor,
        'valor_editado_financeiro', true,
        'valor_editado_por', p_user_id,
        'valor_editado_em', now()
      ),
      updated_at = now(),
      updated_by = p_user_id
  WHERE bi.id = v_item.id;

  SELECT c.nome INTO v_author_name FROM people.colaboradores c
  WHERE c.user_id = p_user_id AND c.tenant_id = v_tenant_id LIMIT 1;

  INSERT INTO finance.revisao_fatura_itens_historico (
    billing_item_id, role, author_id, author_name, horas, valor, texto, tenant_id, created_at
  ) VALUES (
    v_item.id, 'APROVADOR', p_user_id, COALESCE(v_author_name, 'Financeiro'),
    COALESCE(v_item.horas_aprovadas, v_item.horas_revisadas, v_item.horas_informadas),
    v_valor,
    'Valor final ajustado pelo financeiro na etapa 3',
    v_tenant_id, now()
  );

  INSERT INTO finance.billing_item_audit (tenant_id, billing_item_id, action, field_name, old_value, new_value, changed_by)
  VALUES (v_tenant_id, v_item.id, 'editar_valor_final', 'valor_aprovado', to_jsonb(v_item.valor_aprovado), to_jsonb(v_valor), p_user_id);

  RETURN jsonb_build_object('billing_item_id', v_item.id, 'valor_aprovado', v_valor);
END;
$function$;
