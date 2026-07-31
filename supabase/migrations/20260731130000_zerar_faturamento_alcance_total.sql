-- Zerar faturamento: alcance total (pedido Filipe, áudio 31/07).
--
-- Antes, o botão só apagava itens cujo período coubesse inteiro no mês
-- digitado — item de junho sobrevivia ao "zerar julho" e o botão parecia
-- quebrado. A semântica confirmada pelo cliente é a de MÁSCARA DE RESET:
-- limpa a esteira INTEIRA, preserva regras/casos/timesheets, devolve as
-- horas para "em lançamento" para o próximo ciclo recarregar tudo.
--
-- Os parâmetros de período são mantidos por compatibilidade com o front,
-- mas deixam de restringir o apagamento.
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

  -- Proteção: nota fiscal VIVA (não cancelada) indica faturamento real em
  -- curso — cancele antes de zerar. Nota cancelada não bloqueia (o histórico
  -- fiscal fica preservado; só a esteira é limpa).
  IF EXISTS (
    SELECT 1 FROM finance.billing_notes n
    WHERE n.tenant_id = v_tenant_id
      AND n.tipo_documento = 'nota_fiscal_servico'
      AND COALESCE(n.status, '') NOT ILIKE '%cancel%'
  ) THEN
    RAISE EXCEPTION 'Há notas fiscais emitidas e não canceladas — cancele as notas antes de zerar.';
  END IF;

  -- Devolve TODAS as horas em circulação para "em lançamento": é o que faz
  -- o Gerar/Liberar recarregá-las no ciclo seguinte.
  UPDATE operations.timesheets t
  SET status = 'em_lancamento', updated_at = now(), updated_by = auth.uid()
  WHERE t.tenant_id = v_tenant_id
    AND t.status IN ('revisao', 'aprovado');
  GET DIAGNOSTICS v_ts = ROW_COUNT;

  DELETE FROM finance.revisao_fatura_itens_historico h
  WHERE h.tenant_id = v_tenant_id;

  -- billing_item_audit cai por ON DELETE CASCADE.
  DELETE FROM finance.billing_items
  WHERE tenant_id = v_tenant_id;
  GET DIAGNOSTICS v_itens = ROW_COUNT;

  -- Lotes sem nota pendurada somem; lote com nota (mesmo cancelada) fica,
  -- para a nota não perder a referência.
  DELETE FROM finance.billing_batches b
  WHERE b.tenant_id = v_tenant_id
    AND NOT EXISTS (SELECT 1 FROM finance.billing_notes n WHERE n.billing_batch_id = b.id);
  GET DIAGNOSTICS v_batches = ROW_COUNT;

  RETURN jsonb_build_object(
    'itens_removidos', v_itens,
    'lotes_removidos', v_batches,
    'timesheets_devolvidos', v_ts
  );
END;
$function$;
