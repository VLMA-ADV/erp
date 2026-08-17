-- =====================================================================
-- Editar e excluir conta JÁ BAIXADA
--
-- Filipe, 17/08: "Você consegue criar o botão de editar e excluir também para
-- as contas já pagas? como estamos em fase de testes quero ter essa
-- flexibilidade".
--
-- ISTO REMOVE UMA TRAVA DE PROPÓSITO, e vale saber o que ela protegia: mexer
-- num lançamento já baixado muda o caixa PARA TRÁS. O saldo inicial de todo
-- mês seguinte é a soma das baixas anteriores — apagar ou reprecificar uma
-- baixa de junho move o saldo de julho, agosto e todos os outros. Enquanto o
-- escritório está testando e lançando dados de mentira, isso é o que se quer.
-- Quando virar operação de verdade, vale repor a trava (ou trocá-la por um
-- estorno, que desfaz a baixa deixando rastro em vez de reescrever o passado).
--
-- Cancelado continua intocável nos dois casos: é o estado final de algo que
-- já foi desfeito.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.cp_editar_lancamento(p_user_id uuid, p_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'finance', 'core'
AS $function$
DECLARE
  v_tenant uuid;
  v_row finance.lancamentos%ROWTYPE;
  v_valor numeric(14,2);
  v_venc date;
BEGIN
  v_tenant := finance._cp_tenant(p_user_id);
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem tenant'; END IF;
  IF NOT finance._cp_pode(p_user_id, 'finance.contas_pagar.write') THEN
    RAISE EXCEPTION 'Sem permissão'; END IF;

  SELECT * INTO v_row FROM finance.lancamentos WHERE id = p_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lançamento não encontrado'; END IF;

  IF v_row.status = 'cancelado' THEN
    RAISE EXCEPTION 'Lançamento cancelado não pode ser editado';
  END IF;

  v_valor := NULLIF(p_payload->>'valor','')::numeric;
  IF v_valor IS NULL OR v_valor <= 0 THEN RAISE EXCEPTION 'Valor é obrigatório'; END IF;
  v_venc := NULLIF(p_payload->>'vencimento','')::date;
  IF v_venc IS NULL THEN RAISE EXCEPTION 'Vencimento é obrigatório'; END IF;
  IF COALESCE(p_payload->>'descricao','') = '' THEN RAISE EXCEPTION 'Descrição é obrigatória'; END IF;

  UPDATE finance.lancamentos SET
    fornecedor_nome = NULLIF(p_payload->>'fornecedor_nome',''),
    empresa_id = NULLIF(p_payload->>'empresa_id','')::uuid,
    descricao = p_payload->>'descricao',
    conta_contabil_id = NULLIF(p_payload->>'conta_contabil_id','')::uuid,
    plano_conta_id = NULLIF(p_payload->>'plano_conta_id','')::uuid,
    centro_custo_id = NULLIF(p_payload->>'centro_custo_id','')::uuid,
    valor = v_valor,
    vencimento = v_venc,
    reembolsavel = COALESCE((p_payload->>'reembolsavel')::boolean, false),
    numero_nota = NULLIF(p_payload->>'numero_nota',''),
    forma_pagamento = NULLIF(p_payload->>'forma_pagamento',''),
    conta_bancaria_id = NULLIF(p_payload->>'conta_bancaria_id','')::uuid,
    observacoes = NULLIF(p_payload->>'observacoes',''),
    updated_at = now()
  WHERE id = p_id AND tenant_id = v_tenant;

  -- O reembolso vinculado acompanha o valor/vencimento corrigidos, senao ele
  -- fica cobrando um valor que a origem ja nao tem mais.
  UPDATE finance.lancamentos SET
    valor = v_valor, vencimento = v_venc, updated_at = now()
  WHERE reembolso_de_id = p_id AND tenant_id = v_tenant AND status = 'pendente';

  RETURN jsonb_build_object('id', p_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.cp_excluir_lancamento(p_user_id uuid, p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'finance', 'core'
AS $function$
DECLARE
  v_tenant uuid;
  v_row finance.lancamentos%ROWTYPE;
  v_reembolsos_cancelados int := 0;
BEGIN
  v_tenant := finance._cp_tenant(p_user_id);
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem tenant'; END IF;
  IF NOT finance._cp_pode(p_user_id, 'finance.contas_pagar.write') THEN
    RAISE EXCEPTION 'Sem permissão'; END IF;

  SELECT * INTO v_row FROM finance.lancamentos WHERE id = p_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lançamento não encontrado'; END IF;

  IF v_row.status = 'cancelado' THEN
    RAISE EXCEPTION 'Lançamento já está cancelado';
  END IF;

  UPDATE finance.lancamentos SET status = 'cancelado', updated_at = now()
  WHERE id = p_id AND tenant_id = v_tenant;

  UPDATE finance.lancamentos SET status = 'cancelado', updated_at = now()
  WHERE reembolso_de_id = p_id AND tenant_id = v_tenant AND status = 'pendente';
  GET DIAGNOSTICS v_reembolsos_cancelados = ROW_COUNT;

  RETURN jsonb_build_object('id', p_id, 'reembolso_cancelado_junto', v_reembolsos_cancelados > 0);
END;
$function$;


