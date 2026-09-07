-- =====================================================================
-- Conta a receber (e boleto) = NFS-e + despesas do mesmo escopo
--
-- Filipe, 07/09: "As despesas geram a nota de debito individualmente [...]
-- O boleto sim que deve somar o valor da NF + despesas (nota de debito)."
--
-- A NFS-e cobre so honorarios (20260907100000). A conta a receber nascia com
-- o valor da nota, entao o boleto cobrava so honorarios e a despesa ficava
-- sem cobranca nenhuma. Agora, quando a nota autoriza:
--   1. soma as despesas APROVADAS do mesmo escopo (caso da nota, ou contrato
--      inteiro quando a nota e do contrato) ao valor da conta a receber;
--   2. marca essas despesas como 'faturado', para nao entrarem em outro
--      boleto — elas continuam aparecendo na Nota de Despesas (que le item
--      faturado tambem);
--   3. grava na nota quais despesas entraram (metadata.despesas_no_boleto),
--      para auditoria e para o cancelamento em cadeia devolve-las.
-- Despesa aprovada DEPOIS da nota autorizar nao entra neste boleto.
-- =====================================================================
CREATE OR REPLACE FUNCTION finance.criar_recebivel_da_nota(p_nota_id uuid, p_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'finance', 'contracts', 'crm', 'public'
AS $$
DECLARE
  v_id uuid;
  v_nota finance.billing_notes%ROWTYPE;
  v_despesas numeric := 0;
  v_ids uuid[] := '{}';
BEGIN
  SELECT * INTO v_nota FROM finance.billing_notes WHERE id = p_nota_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- Elegivel? (mesmas condicoes de antes)
  IF v_nota.status <> 'gerado'
     OR NOT (v_nota.focus_ref IS NULL OR v_nota.focus_status = 'autorizado')
     OR COALESCE(NULLIF(v_nota.metadata->>'valor_total','')::numeric, 0) <= 0
     OR EXISTS (SELECT 1 FROM finance.lancamentos l
                 WHERE l.tenant_id = v_nota.tenant_id AND l.origem = 'faturamento'
                   AND l.origem_ref_id = v_nota.id AND l.status <> 'cancelado')
  THEN
    RETURN NULL;
  END IF;

  -- Despesas aprovadas do escopo da nota.
  SELECT COALESCE(array_agg(bi.id), '{}'), COALESCE(SUM(COALESCE(bi.valor_aprovado, bi.valor_revisado, 0)), 0)
    INTO v_ids, v_despesas
  FROM finance.billing_items bi
  WHERE bi.tenant_id = v_nota.tenant_id
    AND bi.origem_tipo = 'despesa'
    AND bi.status = 'aprovado'
    AND (
      (v_nota.caso_id IS NOT NULL AND bi.caso_id = v_nota.caso_id)
      OR (v_nota.caso_id IS NULL AND bi.contrato_id = v_nota.contrato_id)
    );

  INSERT INTO finance.lancamentos (
    tenant_id, natureza, status, cliente_id, descricao, valor, vencimento,
    origem, origem_ref_id, created_by)
  SELECT
    v_nota.tenant_id, 'receber', 'pendente', ct.cliente_id,
    CASE WHEN v_despesas > 0 THEN 'Honorários e despesas — ' ELSE 'Honorários — ' END
      || COALESCE(cli.nome, 'cliente')
      || COALESCE(' (NF #' || v_nota.numero || ')', ''),
    COALESCE(NULLIF(v_nota.metadata->>'valor_total','')::numeric, 0) + v_despesas,
    finance.vencimento_para_nota(v_nota.id),
    'faturamento', v_nota.id, p_user_id
  FROM contracts.contratos ct
  LEFT JOIN crm.clientes cli ON cli.id = ct.cliente_id
  WHERE ct.id = v_nota.contrato_id
  RETURNING id INTO v_id;

  IF v_id IS NOT NULL AND cardinality(v_ids) > 0 THEN
    UPDATE finance.billing_items
       SET status = 'faturado', updated_at = now()
     WHERE id = ANY(v_ids);

    UPDATE finance.billing_notes
       SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
             'despesas_no_boleto', jsonb_build_object(
               'item_ids', to_jsonb(v_ids), 'valor', v_despesas, 'lancamento_id', v_id))
     WHERE id = v_nota.id;
  END IF;

  RETURN v_id;
END $$;
