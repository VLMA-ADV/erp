-- BB-16b: ao avançar status (em_revisao -> em_aprovacao, em_aprovacao -> aprovado),
-- registrar linha em finance.revisao_fatura_itens_historico (alinhado a update_revisao_fatura_item).
-- Idempotente: CREATE OR REPLACE na função existente; não remove histórico.

CREATE OR REPLACE FUNCTION public.set_revisao_fatura_status(p_user_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_tenant_id uuid;
  v_item_id uuid;
  v_batch_id uuid;
  v_action text;
  v_item finance.billing_items%ROWTYPE;
  v_old_status varchar;
  v_new_status varchar;
  v_batch_status varchar;
  v_can_review boolean := false;
  v_can_approve boolean := false;
  v_can_revert boolean := false;
  v_can_manage boolean := false;
  v_author_name text;
BEGIN
  SELECT tenant_id INTO v_tenant_id
  FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id
    AND tu.status = 'ativo'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não associado a tenant';
  END IF;

  v_item_id := NULLIF(p_payload->>'billing_item_id', '')::uuid;
  v_batch_id := NULLIF(p_payload->>'billing_batch_id', '')::uuid;
  v_action := lower(trim(COALESCE(p_payload->>'action', '')));

  IF v_item_id IS NULL THEN
    RAISE EXCEPTION 'billing_item_id é obrigatório';
  END IF;

  IF v_action NOT IN ('avancar', 'retornar') THEN
    RAISE EXCEPTION 'Ação inválida. Use avancar ou retornar';
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.get_user_permissions(p_user_id) p WHERE p.permission_key IN ('finance.faturamento.review', 'finance.faturamento.*', 'finance.*', '*')) INTO v_can_review;
  SELECT EXISTS (SELECT 1 FROM public.get_user_permissions(p_user_id) p WHERE p.permission_key IN ('finance.faturamento.approve', 'finance.faturamento.*', 'finance.*', '*')) INTO v_can_approve;
  SELECT EXISTS (SELECT 1 FROM public.get_user_permissions(p_user_id) p WHERE p.permission_key IN ('finance.faturamento.revert', 'finance.faturamento.*', 'finance.*', '*')) INTO v_can_revert;
  SELECT EXISTS (SELECT 1 FROM public.get_user_permissions(p_user_id) p WHERE p.permission_key IN ('finance.faturamento.manage', 'finance.faturamento.*', 'finance.*', '*')) INTO v_can_manage;

  SELECT * INTO v_item
  FROM finance.billing_items bi
  WHERE bi.id = v_item_id
    AND bi.tenant_id = v_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item de faturamento não encontrado';
  END IF;

  IF v_batch_id IS NOT NULL AND v_item.billing_batch_id IS DISTINCT FROM v_batch_id THEN
    RAISE EXCEPTION 'Item não pertence ao lote informado';
  END IF;

  v_old_status := v_item.status;
  v_new_status := v_old_status;

  IF v_action = 'avancar' THEN
    IF v_old_status = 'em_revisao' THEN
      IF NOT (v_can_review OR v_can_manage) THEN
        RAISE EXCEPTION 'Sem permissão para avançar item em revisão';
      END IF;
      v_new_status := 'em_aprovacao';

      SELECT c.nome INTO v_author_name
      FROM people.colaboradores c
      WHERE c.user_id = p_user_id AND c.tenant_id = v_tenant_id
      LIMIT 1;

      INSERT INTO finance.revisao_fatura_itens_historico (
        billing_item_id, role, author_id, author_name, horas, valor, texto, tenant_id, created_at
      ) VALUES (
        v_item.id,
        'REVISOR',
        p_user_id,
        COALESCE(v_author_name, 'Usuário'),
        COALESCE(v_item.horas_revisadas, v_item.horas_informadas, 0),
        COALESCE(v_item.valor_revisado, v_item.valor_informado, 0)::numeric(12,2),
        NULL,
        v_tenant_id,
        now()
      );

      UPDATE finance.billing_items bi
      SET
        status = v_new_status,
        horas_revisadas = COALESCE(bi.horas_revisadas, bi.horas_informadas, 0),
        valor_revisado = COALESCE(bi.valor_revisado, bi.valor_informado, 0),
        data_revisao = now(),
        responsavel_revisao_id = p_user_id,
        updated_at = now(),
        updated_by = p_user_id
      WHERE bi.id = v_item.id;
    ELSIF v_old_status = 'em_aprovacao' THEN
      IF NOT (v_can_approve OR v_can_manage) THEN
        RAISE EXCEPTION 'Sem permissão para avançar item em aprovação';
      END IF;
      v_new_status := 'aprovado';

      SELECT c.nome INTO v_author_name
      FROM people.colaboradores c
      WHERE c.user_id = p_user_id AND c.tenant_id = v_tenant_id
      LIMIT 1;

      INSERT INTO finance.revisao_fatura_itens_historico (
        billing_item_id, role, author_id, author_name, horas, valor, texto, tenant_id, created_at
      ) VALUES (
        v_item.id,
        'APROVADOR',
        p_user_id,
        COALESCE(v_author_name, 'Usuário'),
        COALESCE(v_item.horas_aprovadas, v_item.horas_revisadas, v_item.horas_informadas, 0),
        COALESCE(v_item.valor_aprovado, v_item.valor_revisado, v_item.valor_informado, 0)::numeric(12,2),
        NULL,
        v_tenant_id,
        now()
      );

      UPDATE finance.billing_items bi
      SET
        status = v_new_status,
        horas_aprovadas = COALESCE(bi.horas_aprovadas, bi.horas_revisadas, bi.horas_informadas, 0),
        valor_aprovado = COALESCE(bi.valor_aprovado, bi.valor_revisado, bi.valor_informado, 0),
        data_aprovacao = now(),
        responsavel_aprovacao_id = p_user_id,
        updated_at = now(),
        updated_by = p_user_id
      WHERE bi.id = v_item.id;
    ELSE
      RAISE EXCEPTION 'Não é possível avançar item no status %', v_old_status;
    END IF;
  ELSE
    IF v_old_status = 'em_aprovacao' THEN
      IF NOT (v_can_revert OR v_can_manage) THEN
        RAISE EXCEPTION 'Sem permissão para retornar item em aprovação';
      END IF;
      v_new_status := 'em_revisao';
    ELSIF v_old_status = 'aprovado' THEN
      IF NOT (v_can_revert OR v_can_manage) THEN
        RAISE EXCEPTION 'Sem permissão para retornar item aprovado';
      END IF;
      v_new_status := 'em_aprovacao';
    ELSE
      RAISE EXCEPTION 'Não é possível retornar item no status %', v_old_status;
    END IF;

    UPDATE finance.billing_items bi
    SET status = v_new_status, updated_at = now(), updated_by = p_user_id
    WHERE bi.id = v_item.id;
  END IF;

  INSERT INTO finance.billing_item_audit (tenant_id, billing_item_id, action, field_name, old_value, new_value, changed_by)
  VALUES (v_tenant_id, v_item.id, 'status_transition', 'status', to_jsonb(v_old_status), to_jsonb(v_new_status), p_user_id);

  IF v_item.billing_batch_id IS NOT NULL THEN
    SELECT
      CASE
        WHEN counts.em_revisao > 0 THEN 'em_revisao'
        WHEN counts.em_aprovacao > 0 THEN 'em_aprovacao'
        WHEN counts.aprovado > 0 THEN 'aprovado'
        WHEN counts.faturado > 0 THEN 'faturado'
        ELSE 'cancelado'
      END
    INTO v_batch_status
    FROM (
      SELECT
        count(*) FILTER (WHERE bi.status = 'em_revisao') AS em_revisao,
        count(*) FILTER (WHERE bi.status = 'em_aprovacao') AS em_aprovacao,
        count(*) FILTER (WHERE bi.status = 'aprovado') AS aprovado,
        count(*) FILTER (WHERE bi.status = 'faturado') AS faturado
      FROM finance.billing_items bi
      WHERE bi.tenant_id = v_tenant_id
        AND bi.billing_batch_id = v_item.billing_batch_id
        AND bi.status <> 'cancelado'
    ) counts;

    UPDATE finance.billing_batches b
    SET status = COALESCE(v_batch_status, b.status), updated_at = now(), updated_by = p_user_id
    WHERE b.id = v_item.billing_batch_id
      AND b.tenant_id = v_tenant_id;
  END IF;

  RETURN jsonb_build_object('billing_item_id', v_item.id, 'from_status', v_old_status, 'to_status', v_new_status, 'batch_status', v_batch_status);
END;
$function$;
