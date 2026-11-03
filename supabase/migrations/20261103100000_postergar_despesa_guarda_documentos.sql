-- Postergar despesa que já está em documento (Filipe/Jéssika, 03/11).
--
-- postergar_despesa cancelava o billing_item sem olhar a nota de débito ou a
-- NFS-e que já o contém: a nota seguia viva em outubro e a despesa voltava na
-- fila de novembro, podendo cobrar duas vezes (casos 6251 e 6175). Agora recusa
-- com a nota viva e com o item congelado em kit finalizado.

CREATE OR REPLACE FUNCTION public.postergar_despesa(p_user_id uuid, p_despesa_id uuid, p_periodo date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'operations', 'finance', 'core'
AS $function$
DECLARE
  v_tenant_id uuid;
  v_bi finance.billing_items%ROWTYPE;
  v_nota_tipo text;
  v_cancelou boolean := false;
BEGIN
  -- Quem chama pelo PostgREST é o próprio usuário logado; p_user_id só vale
  -- para chamadas de serviço (mesmo arranjo de get_faturamento_postergados).
  p_user_id := COALESCE(auth.uid(), p_user_id);

  SELECT tenant_id INTO v_tenant_id FROM core.tenant_users
  WHERE user_id = p_user_id AND status = 'ativo' LIMIT 1;
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;

  -- Mesmas permissões de postergar_timesheet.
  IF NOT EXISTS (
    SELECT 1 FROM public.get_user_permissions(p_user_id) p
    WHERE p.permission_key IN ('finance.faturamento.write','finance.faturamento.manage',
                               'finance.faturamento.review','finance.faturamento.*','finance.*','*')
  ) THEN
    RAISE EXCEPTION 'Sem permissão para postergar lançamento';
  END IF;

  IF p_periodo IS NULL THEN RAISE EXCEPTION 'Novo período é obrigatório'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM operations.despesas d
    WHERE d.id = p_despesa_id AND d.tenant_id = v_tenant_id AND d.apagado_em IS NULL
  ) THEN
    RAISE EXCEPTION 'Despesa não encontrada';
  END IF;

  -- Já virou billing_item (postergando da revisão/aprovação, não da fila):
  -- sai da fatura atual, senão conta agora E de novo no mês de destino.
  SELECT * INTO v_bi FROM finance.billing_items bi
  WHERE bi.tenant_id = v_tenant_id AND bi.origem_tipo = 'despesa'
    AND bi.origem_id = p_despesa_id AND bi.status <> 'cancelado';

  IF FOUND THEN
    IF v_bi.status = 'faturado' THEN
      RAISE EXCEPTION 'Despesa já faturada não pode ser postergada';
    END IF;

    SELECT n.tipo_documento INTO v_nota_tipo FROM finance.billing_notes n
    WHERE n.tenant_id = v_tenant_id AND n.status <> 'cancelado'
      AND n.tipo_documento IN ('nota_debito', 'nota_fiscal_servico')
      AND n.metadata->'item_ids' ? v_bi.id::text
    LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'Despesa nº % já está em %. Cancele o documento antes de postergar.', v_bi.numero,
        CASE v_nota_tipo WHEN 'nota_debito' THEN 'nota de débito' ELSE 'NFS-e' END;
    END IF;

    IF EXISTS (
      SELECT 1 FROM finance.kits k
      WHERE k.tenant_id = v_tenant_id AND k.finalizado_em IS NOT NULL AND v_bi.id = ANY (k.item_ids)
    ) THEN
      RAISE EXCEPTION 'Despesa nº % está em kit finalizado. Reabra o kit antes de postergar.', v_bi.numero;
    END IF;

    UPDATE finance.billing_items
    SET status = 'cancelado', grupo_id = NULL, updated_at = now(), updated_by = p_user_id
    WHERE id = v_bi.id;
    v_cancelou := true;
  END IF;

  -- O cancelamento acima dispara finance.sync_despesa_status_from_billing_item,
  -- que marca a despesa como 'cancelado'. Aqui ela não foi cancelada, foi
  -- adiada: volta para 'em_lancamento' e reaparece na fila do mês escolhido.
  UPDATE operations.despesas
  SET periodo_faturamento = date_trunc('month', p_periodo)::date,
      status = CASE WHEN v_cancelou OR status IN ('revisao', 'aprovado') THEN 'em_lancamento' ELSE status END,
      updated_at = now(), updated_by = p_user_id
  WHERE id = p_despesa_id AND tenant_id = v_tenant_id;

  RETURN jsonb_build_object('id', p_despesa_id, 'periodo_faturamento', date_trunc('month', p_periodo)::date);
END;
$function$;
