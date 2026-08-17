-- =====================================================================
-- Editar o lote de adiantamento
--
-- Filipe, 17/08: "Me permita visualizar e editar os lotes dos usuários".
--
-- Existiam criar, cancelar, fechar e validar. Faltava editar: se o valor do
-- adiantamento foi digitado errado, ou a transferência saiu de outra conta, a
-- única saída era cancelar e refazer — e cancelar um lote que já tem despesas
-- lançadas nele é justamente o que não se pode fazer.
--
-- O QUE NÃO SE EDITA, e por quê:
--   * a pessoa do lote — trocar o dono faria as despesas já lançadas mudarem
--     de mão sem ninguém pedir. Para isso, cancela e cria outro.
--   * lote fechado ou cancelado — o acerto já foi gerado (virou conta a pagar
--     ou a receber); mexer no valor aqui deixaria o acerto apontando para um
--     número que não existe mais.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.editar_lote_despesa(p_user_id uuid, p_lote_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'operations', 'finance', 'core'
AS $function$
DECLARE
  v_tenant_id uuid;
  v_lote operations.despesa_lotes%ROWTYPE;
  v_valor numeric(14,2);
BEGIN
  p_user_id := COALESCE(auth.uid(), p_user_id);

  SELECT tenant_id INTO v_tenant_id FROM core.tenant_users
  WHERE user_id = p_user_id AND status = 'ativo' LIMIT 1;
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;

  -- Editar lote é do financeiro, não do dono: o dono lança despesa dentro do
  -- lote, quem mexe no adiantamento é quem transferiu o dinheiro.
  IF NOT finance._cp_pode(p_user_id, 'finance.contas_pagar.write') THEN
    RAISE EXCEPTION 'Sem permissão para editar lote';
  END IF;

  SELECT * INTO v_lote FROM operations.despesa_lotes
  WHERE id = p_lote_id AND tenant_id = v_tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lote não encontrado'; END IF;

  IF v_lote.status IN ('fechado', 'cancelado') THEN
    RAISE EXCEPTION 'Lote % não pode mais ser editado', v_lote.status;
  END IF;

  v_valor := COALESCE(NULLIF(p_payload->>'valor', '')::numeric, v_lote.valor);
  IF v_valor <= 0 THEN RAISE EXCEPTION 'Valor do adiantamento deve ser maior que zero'; END IF;

  UPDATE operations.despesa_lotes SET
    valor = v_valor,
    descricao = COALESCE(NULLIF(p_payload->>'descricao', ''), descricao),
    conta_bancaria_origem_id = COALESCE(NULLIF(p_payload->>'conta_bancaria_origem_id', '')::uuid, conta_bancaria_origem_id),
    conta_bancaria_destino_id = COALESCE(NULLIF(p_payload->>'conta_bancaria_destino_id', '')::uuid, conta_bancaria_destino_id),
    data_transferencia = COALESCE(NULLIF(p_payload->>'data_transferencia', '')::date, data_transferencia),
    updated_at = now(),
    updated_by = p_user_id
  WHERE id = p_lote_id AND tenant_id = v_tenant_id;

  RETURN jsonb_build_object('id', p_lote_id, 'valor', v_valor);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.editar_lote_despesa(uuid, uuid, jsonb) TO authenticated, service_role;
