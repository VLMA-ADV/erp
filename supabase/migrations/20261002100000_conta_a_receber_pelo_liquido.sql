-- Filipe (01/10): "os boletos bancários foram emitidos nos valores brutos".
-- A conta a receber nascia com metadata.valor_total (bruto da NFS-e) e o
-- boleto copia o valor da conta. As retenções federais (IRRF, PIS, COFINS,
-- CSLL) e o ISS retido pelo tomador, quando houver, saem do que o cliente
-- paga - o boleto tem que ser pelo líquido. Notas 2094 (15.000 -> 13.530) e
-- 2096 (25.000 -> 22.550) sairam erradas.
--
-- O líquido vem do que foi mandado à prefeitura (metadata.focus_request),
-- que é a fonte do que a nota de fato diz. tipo_retencao_iss: 1 = ISS não
-- retido (recolhido pela VLMA, não abate); 2/3 = retido pelo tomador/
-- intermediário (abate).
CREATE OR REPLACE FUNCTION finance.valor_liquido_da_nota(p_metadata jsonb)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  WITH r AS (SELECT COALESCE(p_metadata->'focus_request', '{}'::jsonb) AS q)
  SELECT GREATEST(0, round(
    COALESCE(NULLIF(p_metadata->>'valor_total','')::numeric, 0)
    - COALESCE(NULLIF(q->>'valor_irrf','')::numeric, 0)
    - COALESCE(NULLIF(q->>'valor_pis','')::numeric, 0)
    - COALESCE(NULLIF(q->>'valor_cofins','')::numeric, 0)
    - COALESCE(NULLIF(q->>'valor_csll','')::numeric, 0)
    - COALESCE(NULLIF(q->>'valor_inss','')::numeric, 0)
    - CASE WHEN COALESCE(NULLIF(q->>'tipo_retencao_iss','')::int, 1) IN (2, 3)
           THEN COALESCE(NULLIF(q->>'valor_iss','')::numeric, NULLIF(p_metadata->>'valor_iss','')::numeric, 0)
           ELSE 0 END
  , 2)) FROM r;
$$;
GRANT EXECUTE ON FUNCTION finance.valor_liquido_da_nota(jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION finance.criar_recebivel_da_nota(p_nota_id uuid, p_user_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'finance', 'contracts', 'crm', 'public'
AS $function$
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
    -- Liquido da nota (bruto - retencoes), nao o bruto (Filipe, 01/10).
    finance.valor_liquido_da_nota(v_nota.metadata) + v_despesas,
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
END $function$

;
