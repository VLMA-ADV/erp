-- Mover caso de contrato leva junto o que é do caso.
--
-- Antes, transferir_caso só trocava contracts.casos.contrato_id: lançamentos,
-- despesas e itens de faturamento abertos ficavam no contrato antigo. Efeito:
-- caso em dois kits na Composição, NFS-e duplicada no card e relatório somando
-- horas de outro kit.
--
-- Agora, na mesma transação:
--   * operations.timesheets e operations.despesas do caso vão para o destino;
--   * finance.billing_items do caso NÃO faturados e NÃO cancelados
--     (em_revisao/em_aprovacao/aprovado/ignorado) vão para o contrato de
--     destino, com as chaves contrato_* do snapshot e das linhas de
--     snapshot.timesheet_itens_revisao atualizadas. O cliente (coluna e chaves
--     cliente_* do snapshot) só é trocado onde era o cliente do contrato antigo:
--     item faturado contra um pagador do caso continua com o pagador;
--   * itens faturados ficam onde estão (estão em NFS-e emitida);
--   * kit ainda não finalizado do caso acompanha, se o destino não tiver kit
--     da mesma competência;
--   * recusa se algum item aberto do caso estiver numa NFS-e autorizada /
--     processando (mesma trava de transferir_billing_item_caso) ou agrupado com
--     item de outro caso;
--   * grava auditoria por item (finance.billing_item_audit) e da transferência
--     (core.audit_logs, tipo_entidade contracts.casos) e devolve as contagens.

-- Snapshot de um item apontando para outro contrato: só reescreve as chaves que
-- já existem; nas linhas da revisão troca contrato_id. Com p_cliente_id NULL as
-- chaves de cliente ficam como estão.
CREATE OR REPLACE FUNCTION finance._snapshot_para_contrato(
  p_snapshot jsonb,
  p_contrato_id uuid,
  p_contrato_numero bigint,
  p_contrato_nome text,
  p_cliente_id uuid,
  p_cliente_nome text
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $function$
DECLARE
  v jsonb := COALESCE(p_snapshot, '{}'::jsonb);
BEGIN
  IF jsonb_typeof(v) <> 'object' THEN
    RETURN p_snapshot;
  END IF;
  IF v ? 'contrato_id'     THEN v := v || jsonb_build_object('contrato_id', p_contrato_id); END IF;
  IF v ? 'contrato_numero' THEN v := v || jsonb_build_object('contrato_numero', p_contrato_numero); END IF;
  IF v ? 'contrato_nome'   THEN v := v || jsonb_build_object('contrato_nome', p_contrato_nome); END IF;
  IF p_cliente_id IS NOT NULL AND v ? 'cliente_id'   THEN v := v || jsonb_build_object('cliente_id', p_cliente_id); END IF;
  IF p_cliente_id IS NOT NULL AND v ? 'cliente_nome' THEN v := v || jsonb_build_object('cliente_nome', p_cliente_nome); END IF;
  IF jsonb_typeof(v->'timesheet_itens_revisao') = 'array' THEN
    v := jsonb_set(v, '{timesheet_itens_revisao}', COALESCE((
      SELECT jsonb_agg(CASE WHEN jsonb_typeof(r) = 'object'
                            THEN r || jsonb_build_object('contrato_id', p_contrato_id)
                                   || CASE WHEN p_cliente_id IS NOT NULL AND r ? 'cliente_id'
                                           THEN jsonb_build_object('cliente_id', p_cliente_id)
                                           ELSE '{}'::jsonb END
                            ELSE r END ORDER BY o)
        FROM jsonb_array_elements(v->'timesheet_itens_revisao') WITH ORDINALITY AS x(r, o)
    ), '[]'::jsonb));
  END IF;
  RETURN v;
END;
$function$;

REVOKE ALL ON FUNCTION finance._snapshot_para_contrato(jsonb, uuid, bigint, text, uuid, text) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.transferir_caso(p_user_id uuid, p_caso_id uuid, p_novo_contrato_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'contracts', 'core', 'finance', 'operations', 'crm'
AS $function$
DECLARE
  v_tenant uuid;
  v_caso record;
  v_old_cliente uuid;
  v_dest record;
  v_nota record;
  v_item_numero bigint;
  v_itens int := 0;
  v_ts int := 0;
  v_desp int := 0;
  v_kits int := 0;
  v_faturados int := 0;
BEGIN
  p_user_id := COALESCE(auth.uid(), p_user_id);

  SELECT tenant_id INTO v_tenant FROM core.tenant_users WHERE user_id=p_user_id AND status='ativo' LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;

  SELECT cs.id, cs.numero, cs.contrato_id INTO v_caso
    FROM contracts.casos cs
   WHERE cs.id = p_caso_id AND cs.tenant_id = v_tenant
   FOR UPDATE;
  IF NOT FOUND OR v_caso.contrato_id IS NULL THEN RAISE EXCEPTION 'Caso não encontrado'; END IF;

  SELECT ct.id, ct.numero, ct.nome_contrato, ct.cliente_id, cl.nome AS cliente_nome
    INTO v_dest
    FROM contracts.contratos ct
    LEFT JOIN crm.clientes cl ON cl.id = ct.cliente_id
   WHERE ct.id = p_novo_contrato_id AND ct.tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Contrato de destino inválido'; END IF;
  IF p_novo_contrato_id = v_caso.contrato_id THEN
    RAISE EXCEPTION 'O caso já pertence a este contrato';
  END IF;
  IF v_dest.cliente_id IS NULL THEN
    RAISE EXCEPTION 'O contrato de destino não tem cliente; não é possível mover o faturamento do caso';
  END IF;

  SELECT ct.cliente_id INTO v_old_cliente FROM contracts.contratos ct WHERE ct.id = v_caso.contrato_id;

  -- Trava os itens do caso antes das verificações.
  PERFORM 1 FROM finance.billing_items bi
   WHERE bi.tenant_id = v_tenant AND bi.caso_id = p_caso_id
   FOR UPDATE;

  -- Mesma trava de transferir_billing_item_caso: item aberto numa NFS-e viva.
  SELECT bi.numero AS item_numero, bn.numero, bn.focus_status INTO v_nota
    FROM finance.billing_items bi
    JOIN finance.billing_notes bn
      ON bn.tenant_id = bi.tenant_id
     AND bn.tipo_documento = 'nota_fiscal_servico'
     AND bn.status = 'gerado'
     AND bn.focus_status IN ('autorizado', 'processando')
     AND bn.metadata->'item_ids' ? bi.id::text
   WHERE bi.tenant_id = v_tenant AND bi.caso_id = p_caso_id
     AND bi.status IN ('em_revisao', 'em_aprovacao', 'aprovado', 'ignorado')
   ORDER BY bi.numero
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Não é possível transferir o caso: o item % está na NFS-e % (%) e ainda não foi faturado. Cancele a nota antes de transferir.',
      v_nota.item_numero, v_nota.numero, v_nota.focus_status;
  END IF;

  -- Grupo que mistura item deste caso com item de outro caso não pode ser partido.
  SELECT bi.numero INTO v_item_numero
    FROM finance.billing_items bi
   WHERE bi.tenant_id = v_tenant AND bi.caso_id = p_caso_id
     AND bi.status IN ('em_revisao', 'em_aprovacao', 'aprovado', 'ignorado')
     AND bi.grupo_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM finance.billing_items o
                  WHERE o.tenant_id = v_tenant AND o.grupo_id = bi.grupo_id
                    AND o.caso_id IS DISTINCT FROM p_caso_id
                    AND o.status <> 'cancelado')
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Não é possível transferir o caso: o item % está agrupado com item de outro caso. Desagrupe antes de transferir.',
      v_item_numero;
  END IF;

  UPDATE contracts.casos
     SET contrato_id = p_novo_contrato_id, updated_at = now(), updated_by = p_user_id
   WHERE id = p_caso_id AND tenant_id = v_tenant;

  -- Itens abertos: contrato e snapshot; cliente só onde era o do contrato
  -- antigo do item. Auditoria por item.
  WITH movidos AS (
    UPDATE finance.billing_items bi
       SET contrato_id = v_dest.id,
           cliente_id  = CASE WHEN antes.cliente_id IS NULL OR antes.cliente_id = ca.cliente_id
                              THEN v_dest.cliente_id ELSE antes.cliente_id END,
           snapshot    = finance._snapshot_para_contrato(bi.snapshot, v_dest.id, v_dest.numero, v_dest.nome_contrato,
                           CASE WHEN antes.cliente_id IS NULL OR antes.cliente_id = ca.cliente_id
                                THEN v_dest.cliente_id END,
                           v_dest.cliente_nome),
           updated_at  = now(),
           updated_by  = p_user_id
      FROM finance.billing_items antes
      LEFT JOIN contracts.contratos ca ON ca.id = antes.contrato_id
     WHERE antes.id = bi.id
       AND bi.tenant_id = v_tenant AND bi.caso_id = p_caso_id
       AND bi.status IN ('em_revisao', 'em_aprovacao', 'aprovado', 'ignorado')
       AND bi.contrato_id IS DISTINCT FROM v_dest.id
    RETURNING bi.id, antes.contrato_id AS contrato_antes, antes.cliente_id AS cliente_antes, bi.cliente_id AS cliente_depois
  ), aud AS (
    INSERT INTO finance.billing_item_audit (tenant_id, billing_item_id, action, field_name, old_value, new_value, changed_by)
    SELECT v_tenant, m.id, 'transfer_contract', 'contrato_id',
           jsonb_build_object('contrato_id', m.contrato_antes, 'cliente_id', m.cliente_antes),
           jsonb_build_object('contrato_id', v_dest.id, 'cliente_id', m.cliente_depois, 'via', 'transferir_caso'),
           p_user_id
      FROM movidos m
    RETURNING 1
  )
  SELECT count(*) INTO v_itens FROM aud;

  SELECT count(*) INTO v_faturados
    FROM finance.billing_items bi
   WHERE bi.tenant_id = v_tenant AND bi.caso_id = p_caso_id AND bi.status = 'faturado';

  UPDATE operations.timesheets t
     SET contrato_id = v_dest.id, updated_at = now(), updated_by = p_user_id
   WHERE t.tenant_id = v_tenant AND t.caso_id = p_caso_id
     AND t.contrato_id IS DISTINCT FROM v_dest.id;
  GET DIAGNOSTICS v_ts = ROW_COUNT;

  UPDATE operations.despesas d
     SET contrato_id = v_dest.id,
         cliente_id  = CASE WHEN d.cliente_id IS NULL
                              OR d.cliente_id = (SELECT ca.cliente_id FROM contracts.contratos ca WHERE ca.id = d.contrato_id)
                            THEN v_dest.cliente_id ELSE d.cliente_id END,
         updated_at  = now(),
         updated_by  = p_user_id
   WHERE d.tenant_id = v_tenant AND d.caso_id = p_caso_id
     AND d.contrato_id IS DISTINCT FROM v_dest.id;
  GET DIAGNOSTICS v_desp = ROW_COUNT;

  -- Kit ainda aberto acompanha (finalizado é histórico e fica).
  UPDATE finance.kits k
     SET contrato_id = v_dest.id, updated_at = now()
   WHERE k.tenant_id = v_tenant AND k.caso_id = p_caso_id
     AND k.contrato_id = v_caso.contrato_id
     AND k.finalizado_em IS NULL
     AND NOT EXISTS (SELECT 1 FROM finance.kits o
                      WHERE o.tenant_id = v_tenant AND o.contrato_id = v_dest.id
                        AND o.caso_id = p_caso_id AND o.competencia = k.competencia);
  GET DIAGNOSTICS v_kits = ROW_COUNT;

  INSERT INTO core.audit_logs (tenant_id, tipo_entidade, entidade_id, acao, user_id, dados_anteriores, dados_novos)
  VALUES (v_tenant, 'contracts.casos', p_caso_id, 'update', p_user_id,
          jsonb_build_object('evento', 'transferir_caso', 'contrato_id', v_caso.contrato_id, 'cliente_id', v_old_cliente),
          jsonb_build_object('evento', 'transferir_caso', 'contrato_id', v_dest.id, 'cliente_id', v_dest.cliente_id,
                             'itens_movidos', v_itens, 'lancamentos_movidos', v_ts,
                             'despesas_movidas', v_desp, 'kits_movidos', v_kits,
                             'itens_faturados_mantidos', v_faturados));

  RETURN jsonb_build_object(
    'caso_id', p_caso_id,
    'contrato_anterior', v_caso.contrato_id,
    'novo_contrato', p_novo_contrato_id,
    'itens_movidos', v_itens,
    'lancamentos_movidos', v_ts,
    'despesas_movidas', v_desp,
    'kits_movidos', v_kits,
    'itens_faturados_mantidos', v_faturados
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.transferir_caso(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transferir_caso(uuid, uuid, uuid) TO authenticated, service_role;
