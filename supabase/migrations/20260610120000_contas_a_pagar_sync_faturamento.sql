-- =====================================================================
-- MÓDULO CONTAS A PAGAR — M2.5: SYNC DO FATURAMENTO → CONTAS A RECEBER
-- Depende de: 20260610100000 (tabelas) e 20260610110000 (RPCs).
--
-- Regra (fiel ao áudio do cliente — "a fatura que eu deveria ter recebido"):
--  - Cada NOTA EMITIDA (finance.billing_notes status='gerado') = uma conta a
--    receber (honorários). Canceladas ficam de fora.
--  - Valor vem do metadata.valor_total (billing_notes não tem coluna de valor).
--  - Cliente via contrato_id → contracts.contratos.cliente_id → crm.clientes.
--  - billing_notes não tem vencimento → usa created_at (data de referência); o
--    financeiro REAGENDA conforme o cliente paga (botão já existente).
--  - "recebido" não existe no billing → controlado aqui via baixa (cp_dar_baixa).
--  - Idempotente: não duplica (origem='faturamento' + origem_ref_id = note.id).
-- =====================================================================

CREATE OR REPLACE FUNCTION public.cp_sync_faturamento(p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public, finance, contracts, crm, core AS $$
DECLARE v_tenant uuid; v_criadas int;
BEGIN
  v_tenant := finance._cp_tenant(p_user_id);
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem tenant'; END IF;
  IF NOT finance._cp_pode(p_user_id, 'finance.contas_pagar.read') THEN
    RAISE EXCEPTION 'Sem permissão'; END IF;

  WITH novas AS (
    INSERT INTO finance.lancamentos (
      tenant_id, natureza, status, cliente_id, descricao, valor, vencimento,
      origem, origem_ref_id, created_by)
    SELECT
      v_tenant, 'receber', 'pendente', ct.cliente_id,
      'Honorários — ' || COALESCE(cli.nome, 'cliente')
        || COALESCE(' (NF #' || bn.numero || ')', ''),
      COALESCE(NULLIF(bn.metadata->>'valor_total','')::numeric, 0),
      bn.created_at::date,
      'faturamento', bn.id, p_user_id
    FROM finance.billing_notes bn
    LEFT JOIN contracts.contratos ct  ON ct.id  = bn.contrato_id
    LEFT JOIN crm.clientes        cli ON cli.id = ct.cliente_id
    WHERE bn.tenant_id = v_tenant
      AND bn.status = 'gerado'                      -- fatura emitida (não cancelada)
      AND COALESCE(NULLIF(bn.metadata->>'valor_total','')::numeric, 0) > 0
      AND NOT EXISTS (
        SELECT 1 FROM finance.lancamentos l
        WHERE l.tenant_id = v_tenant
          AND l.origem = 'faturamento'
          AND l.origem_ref_id = bn.id)
    RETURNING 1)
  SELECT count(*) INTO v_criadas FROM novas;

  RETURN jsonb_build_object('recebiveis_criados', v_criadas);
END $$;

GRANT EXECUTE ON FUNCTION public.cp_sync_faturamento(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
