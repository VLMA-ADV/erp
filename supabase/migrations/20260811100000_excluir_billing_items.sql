-- Excluir lancamento do faturamento (pedido Filipe 07/08, esclarecido em 11/08).
--
-- A diferenca para "ignorar", nas palavras dele: ignorar CONSIDERA o lancamento
-- e so nao cobra; excluir tira o item do faturamento como se nao existisse.
-- Sao indicadores diferentes, por isso status diferente.
--
-- Nao toca na origem: o timesheet da pessoa e a regra de cobranca ficam
-- intactos. As horas continuam contando para ela e para os relatorios — some
-- so o item de cobranca, que era o erro de lancamento.
--
-- Usa status 'cancelado', que o resto do sistema ja trata como inexistente:
-- get_itens_a_faturar reabre o timesheet para faturar de novo quando o item
-- esta cancelado, e a revisao nao lista cancelados. Ou seja, excluir devolve o
-- lancamento para a fila de origem em vez de sumir com ele.

CREATE OR REPLACE FUNCTION public.excluir_billing_items(
  p_user_id uuid, p_ids uuid[], p_motivo text DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'finance', 'core'
AS $function$
DECLARE
  v_tenant_id uuid;
  v_count int := 0;
  v_faturados int := 0;
BEGIN
  -- Aceita o usuario por parametro, como agrupar_billing_items: assim a funcao
  -- e testavel fora do navegador, onde auth.uid() e nulo.
  p_user_id := COALESCE(auth.uid(), p_user_id);

  SELECT tenant_id INTO v_tenant_id FROM core.tenant_users
  WHERE user_id = p_user_id AND status = 'ativo' LIMIT 1;
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.get_user_permissions(p_user_id) p
    WHERE p.permission_key IN ('finance.faturamento.review','finance.faturamento.approve',
                               'finance.faturamento.manage','finance.faturamento.*','finance.*','*')
  ) THEN
    RAISE EXCEPTION 'Sem permissão para excluir itens da fatura';
  END IF;

  -- Item ja faturado nao pode ser excluido: existe nota emitida em cima dele.
  SELECT count(*) INTO v_faturados
  FROM finance.billing_items bi
  WHERE bi.tenant_id = v_tenant_id AND bi.id = ANY(p_ids) AND bi.status = 'faturado';

  IF v_faturados > 0 THEN
    RAISE EXCEPTION 'Não é possível excluir lançamento já faturado. Cancele a nota primeiro.';
  END IF;

  UPDATE finance.billing_items bi
  SET status = 'cancelado',
      grupo_id = NULL,
      snapshot = COALESCE(bi.snapshot, '{}'::jsonb) || jsonb_build_object(
        'motivo_excluido', NULLIF(trim(COALESCE(p_motivo, '')), ''),
        'excluido_por', p_user_id,
        'excluido_em', now()
      ),
      updated_at = now(),
      updated_by = p_user_id
  WHERE bi.tenant_id = v_tenant_id
    AND bi.id = ANY(p_ids)
    AND bi.status IN ('em_revisao', 'em_aprovacao', 'aprovado', 'ignorado');
  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object('excluidos', v_count);
END;
$function$;
