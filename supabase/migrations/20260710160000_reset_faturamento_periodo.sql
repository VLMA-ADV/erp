-- B6: reset do faturamento do período para testes ponta a ponta (call de 08/07:
-- "apagar tudo e começar do zero"). Apaga itens/lotes de faturamento do período
-- e devolve os timesheets para 'em_lancamento'. NÃO apaga timesheets/contratos.
-- Restrito a super-admin ('*').

CREATE OR REPLACE FUNCTION public.reset_faturamento_periodo(p_data_inicio date, p_data_fim date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_tenant_id uuid;
  v_itens int := 0;
  v_batches int := 0;
  v_ts int := 0;
BEGIN
  SELECT tenant_id INTO v_tenant_id
  FROM core.tenant_users tu
  WHERE tu.user_id = auth.uid() AND tu.status = 'ativo'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não associado a tenant';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.get_user_permissions(auth.uid()) p
    WHERE p.permission_key IN ('finance.faturamento.manage', 'finance.faturamento.*', 'finance.*', '*')
  ) THEN
    RAISE EXCEPTION 'Apenas quem gerencia o faturamento pode reiniciar o período';
  END IF;

  IF p_data_inicio IS NULL OR p_data_fim IS NULL OR p_data_inicio > p_data_fim THEN
    RAISE EXCEPTION 'Período inválido';
  END IF;

  -- proteção: não reseta período com nota fiscal emitida
  IF EXISTS (
    SELECT 1
    FROM finance.billing_notes n
    JOIN finance.billing_batches b ON b.id = n.billing_batch_id
    WHERE n.tenant_id = v_tenant_id
      AND b.data_inicio >= p_data_inicio
      AND b.data_fim <= p_data_fim
  ) THEN
    RAISE EXCEPTION 'Há notas fiscais emitidas neste período — cancele as notas antes de reiniciar.';
  END IF;

  -- devolve os timesheets enviados no período para lançamento
  UPDATE operations.timesheets t
  SET status = 'em_lancamento', updated_at = now(), updated_by = auth.uid()
  WHERE t.tenant_id = v_tenant_id
    AND t.status = 'revisao'
    AND t.id IN (
      SELECT bi.origem_id FROM finance.billing_items bi
      WHERE bi.tenant_id = v_tenant_id
        AND bi.origem_tipo = 'timesheet'
        AND bi.periodo_inicio >= p_data_inicio
        AND bi.periodo_fim <= p_data_fim
    );
  GET DIAGNOSTICS v_ts = ROW_COUNT;

  DELETE FROM finance.revisao_fatura_itens_historico h
  WHERE h.tenant_id = v_tenant_id
    AND h.billing_item_id IN (
      SELECT id FROM finance.billing_items
      WHERE tenant_id = v_tenant_id
        AND periodo_inicio >= p_data_inicio
        AND periodo_fim <= p_data_fim
    );

  DELETE FROM finance.billing_items
  WHERE tenant_id = v_tenant_id
    AND periodo_inicio >= p_data_inicio
    AND periodo_fim <= p_data_fim;
  GET DIAGNOSTICS v_itens = ROW_COUNT;

  DELETE FROM finance.billing_batches
  WHERE tenant_id = v_tenant_id
    AND data_inicio >= p_data_inicio
    AND data_fim <= p_data_fim
    AND NOT EXISTS (
      SELECT 1 FROM finance.billing_items bi WHERE bi.billing_batch_id = billing_batches.id
    );
  GET DIAGNOSTICS v_batches = ROW_COUNT;

  RETURN jsonb_build_object(
    'itens_removidos', v_itens,
    'lotes_removidos', v_batches,
    'timesheets_devolvidos', v_ts
  );
END;
$function$;

NOTIFY pgrst, 'reload schema';
