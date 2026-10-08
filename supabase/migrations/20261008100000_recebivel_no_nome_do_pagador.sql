-- Filipe (08/10): "ao trocar o pagador, a nota sai para o CNPJ correto, porem o
-- boleto continua em nome do cliente de origem" (NF 2188: nota para Mendocino,
-- boleto 115 para Construtora Strobel). A conta a receber nascia com o cliente
-- do CONTRATO e o boleto copia o cliente da conta. Passa a usar o pagador da
-- nota (metadata.pagador_cliente_id, gravado pela emissao), com o cliente do
-- contrato como fallback. Tambem valia para 2129 (Thiago Coneglian) e 2177 (V&G).
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
  v_meses date[] := '{}';
BEGIN
  SELECT * INTO v_nota FROM finance.billing_notes WHERE id = p_nota_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- Nota de débito tem regra própria (kit só de despesas). Antes caía na
  -- regra da NFS-e via cp_sync_faturamento e dobrava o valor.
  IF v_nota.tipo_documento = 'nota_debito' THEN
    RETURN finance.criar_recebivel_da_nota_debito(p_nota_id, p_user_id);
  END IF;

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

  -- Competência(s) dos itens da nota. A nota de contrato (caso_id null) cobre
  -- um mês (emit-nfse filtra por competência) e as despesas que entram no
  -- boleto dela são as desse mês — não todas as aprovadas do contrato.
  -- focus_request.data_competencia não serve: é a data de emissão.
  SELECT COALESCE(array_agg(DISTINCT date_trunc('month', COALESCE(bi.periodo_inicio, bi.created_at::date))::date), '{}')
    INTO v_meses
    FROM finance.billing_items bi
   WHERE bi.id IN (SELECT x.value::uuid
                     FROM jsonb_array_elements_text(COALESCE(v_nota.metadata->'item_ids', '[]'::jsonb)) x);

  -- Despesas aprovadas do escopo da nota.
  SELECT COALESCE(array_agg(bi.id), '{}'), COALESCE(SUM(COALESCE(bi.valor_aprovado, bi.valor_revisado, 0)), 0)
    INTO v_ids, v_despesas
  FROM finance.billing_items bi
  WHERE bi.tenant_id = v_nota.tenant_id
    AND bi.origem_tipo = 'despesa'
    AND bi.status = 'aprovado'
    AND (
      (v_nota.caso_id IS NOT NULL AND bi.caso_id = v_nota.caso_id)
      OR (v_nota.caso_id IS NULL AND bi.contrato_id = v_nota.contrato_id
          AND (cardinality(v_meses) = 0
               OR date_trunc('month', COALESCE(bi.periodo_inicio, bi.created_at::date))::date = ANY (v_meses)))
    );

  INSERT INTO finance.lancamentos (
    tenant_id, natureza, status, cliente_id, descricao, valor, vencimento,
    origem, origem_ref_id, created_by)
  SELECT
    v_nota.tenant_id, 'receber', 'pendente', COALESCE(NULLIF(v_nota.metadata->>'pagador_cliente_id','')::uuid, ct.cliente_id),
    CASE WHEN v_despesas > 0 THEN 'Honorários e despesas — ' ELSE 'Honorários — ' END
      || COALESCE(cli.nome, 'cliente')
      || COALESCE(' (NF #' || v_nota.numero || ')', ''),
    -- Liquido da nota (bruto - retencoes), nao o bruto (Filipe, 01/10).
    finance.valor_liquido_da_nota(v_nota.metadata) + v_despesas,
    finance.vencimento_para_nota(v_nota.id),
    'faturamento', v_nota.id, p_user_id
  FROM contracts.contratos ct
  -- Quem paga e a conta/boleto: o pagador da nota (ajuste no kit/previa), nao o cliente do contrato
  LEFT JOIN crm.clientes cli ON cli.id = COALESCE(NULLIF(v_nota.metadata->>'pagador_cliente_id','')::uuid, ct.cliente_id)
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
