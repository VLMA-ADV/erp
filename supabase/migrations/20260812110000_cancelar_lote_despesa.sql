-- Cancelar lote de despesa (pedido Filipe 11/08, ao testar a feature e querer
-- tirar da lista os lotes de teste que ele mesmo criou).
--
-- So permite cancelar um lote ABERTO e sem NENHUMA despesa lancada nele — ai o
-- cancelamento e seguro, nao ha nada para desfazer alem do proprio lote e,
-- quando existir, o lancamento do adiantamento. Lote com despesa lancada tem
-- que ser fechado e validado normalmente: cancelar apagaria as despesas do
-- radar sem gerar o acerto que elas geraram.
--
-- Se o lote ja tem o lancamento de saida de caixa (20260811200000), cancela
-- ele tambem — mesmo ja estando 'pago', porque aqui e uma correcao controlada
-- (o adiantamento nunca deveria ter saido), nao uma edicao de rotina; por isso
-- nao passa pela guarda generica de cp_excluir_lancamento.
CREATE OR REPLACE FUNCTION public.cancelar_lote_despesa(p_user_id uuid, p_lote_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'operations', 'finance', 'core'
AS $function$
DECLARE
  v_tenant_id uuid;
  v_lote operations.despesa_lotes%ROWTYPE;
  v_qtd_despesas int;
BEGIN
  p_user_id := COALESCE(auth.uid(), p_user_id);

  SELECT tenant_id INTO v_tenant_id FROM core.tenant_users
  WHERE user_id = p_user_id AND status = 'ativo' LIMIT 1;
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;

  IF NOT finance._cp_pode(p_user_id, 'finance.contas_pagar.write') THEN
    RAISE EXCEPTION 'Sem permissão para cancelar lote de despesas';
  END IF;

  SELECT * INTO v_lote FROM operations.despesa_lotes
  WHERE id = p_lote_id AND tenant_id = v_tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lote não encontrado'; END IF;

  IF v_lote.status <> 'aberto' THEN
    RAISE EXCEPTION 'Só é possível cancelar um lote aberto';
  END IF;

  SELECT count(*) INTO v_qtd_despesas
  FROM operations.despesas d WHERE d.lote_id = p_lote_id AND d.status <> 'cancelado';
  IF v_qtd_despesas > 0 THEN
    RAISE EXCEPTION 'Lote tem % despesa(s) lançada(s) — feche e valide em vez de cancelar', v_qtd_despesas;
  END IF;

  IF v_lote.lancamento_adiantamento_id IS NOT NULL THEN
    UPDATE finance.lancamentos SET status = 'cancelado', updated_at = now()
    WHERE id = v_lote.lancamento_adiantamento_id AND tenant_id = v_tenant_id;
  END IF;

  UPDATE operations.despesa_lotes
  SET status = 'cancelado', updated_at = now(), updated_by = p_user_id
  WHERE id = p_lote_id;

  RETURN jsonb_build_object('id', p_lote_id, 'status', 'cancelado');
END;
$function$;
