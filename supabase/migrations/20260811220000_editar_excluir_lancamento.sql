-- Editar e excluir lançamentos de contas a pagar (pedido Filipe 11/08).
--
-- Hoje so existe "baixar" e "reagendar" — nao da para corrigir um erro de
-- digitacao nem tirar um lancamento duplicado. Bloqueio: lancamento ja baixado
-- (pago/recebido) nao edita nem exclui, porque o dinheiro ja se moveu de fato —
-- mesma logica de "despesa aprovada nao muda" e "item ja faturado nao exclui"
-- que ja existe no resto do sistema.
--
-- Excluir usa 'cancelado', que o resto do sistema ja trata como inexistente
-- (cp_rotina_diaria, os saldos). Quando o lancamento excluido tem um reembolso
-- vinculado (reembolso_de_id) gerado automaticamente, o reembolso cancela
-- junto — senao ficaria um "a receber" orfao, sem lancamento de origem.

CREATE OR REPLACE FUNCTION public.cp_get_lancamento(p_user_id uuid, p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'finance', 'core'
AS $function$
DECLARE
  v_tenant uuid;
  v_row finance.lancamentos%ROWTYPE;
BEGIN
  v_tenant := finance._cp_tenant(p_user_id);
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem tenant'; END IF;
  IF NOT finance._cp_pode(p_user_id, 'finance.contas_pagar.read') THEN
    RAISE EXCEPTION 'Sem permissão'; END IF;

  SELECT * INTO v_row FROM finance.lancamentos WHERE id = p_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lançamento não encontrado'; END IF;

  RETURN jsonb_build_object(
    'id', v_row.id,
    'natureza', v_row.natureza,
    'tipo', v_row.tipo,
    'status', v_row.status,
    'fornecedor_nome', v_row.fornecedor_nome,
    'empresa_id', v_row.empresa_id,
    'descricao', v_row.descricao,
    'conta_contabil_id', v_row.conta_contabil_id,
    'plano_conta_id', v_row.plano_conta_id,
    'centro_custo_id', v_row.centro_custo_id,
    'valor', v_row.valor,
    'vencimento', v_row.vencimento,
    'reembolsavel', v_row.reembolsavel,
    'numero_nota', v_row.numero_nota,
    'forma_pagamento', v_row.forma_pagamento,
    'conta_bancaria_id', v_row.conta_bancaria_id,
    'observacoes', v_row.observacoes,
    'origem', v_row.origem,
    -- Ja baixado: a tela bloqueia edicao/exclusao antes mesmo de chamar a RPC.
    'editavel', v_row.status NOT IN ('pago', 'recebido')
  );
END;
$function$;

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

  IF v_row.status IN ('pago', 'recebido') THEN
    RAISE EXCEPTION 'Lançamento já baixado não pode ser editado';
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

  IF v_row.status IN ('pago', 'recebido') THEN
    RAISE EXCEPTION 'Lançamento já baixado não pode ser excluído';
  END IF;

  UPDATE finance.lancamentos SET status = 'cancelado', updated_at = now()
  WHERE id = p_id AND tenant_id = v_tenant;

  UPDATE finance.lancamentos SET status = 'cancelado', updated_at = now()
  WHERE reembolso_de_id = p_id AND tenant_id = v_tenant AND status = 'pendente';
  GET DIAGNOSTICS v_reembolsos_cancelados = ROW_COUNT;

  RETURN jsonb_build_object('id', p_id, 'reembolso_cancelado_junto', v_reembolsos_cancelados > 0);
END;
$function$;
