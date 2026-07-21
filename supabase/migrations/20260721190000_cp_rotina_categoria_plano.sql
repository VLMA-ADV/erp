-- Tela inicial do Contas a pagar: campo categoria reflete o Plano de Contas.
CREATE OR REPLACE FUNCTION public.cp_rotina_diaria(p_user_id uuid, p_data date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'finance', 'core'
AS $function$
DECLARE v_tenant uuid; v_dia date; v_out jsonb; v_saldo_corrente numeric(14,2);
BEGIN
  v_tenant := finance._cp_tenant(p_user_id);
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem tenant'; END IF;
  IF NOT finance._cp_pode(p_user_id, 'finance.contas_pagar.read') THEN
    RAISE EXCEPTION 'Sem permissão'; END IF;
  v_dia := COALESCE(p_data, CURRENT_DATE);

  -- saldo corrente = soma dos saldos de abertura + recebidos - pagos (após abertura)
  SELECT COALESCE(SUM(cb.saldo_abertura),0)
    + COALESCE((SELECT SUM(l.baixa_valor) FROM finance.lancamentos l
        WHERE l.tenant_id = v_tenant AND l.natureza='receber' AND l.status='recebido'),0)
    - COALESCE((SELECT SUM(l.baixa_valor) FROM finance.lancamentos l
        WHERE l.tenant_id = v_tenant AND l.natureza='pagar' AND l.status='pago'),0)
  INTO v_saldo_corrente
  FROM finance.contas_bancarias cb WHERE cb.tenant_id = v_tenant AND cb.ativo;

  WITH lj AS (
    SELECT l.*,
      -- categoria = conta analítica do Plano de Contas (pedido 21/07); cai na
      -- conta contábil antiga quando o lançamento não tem plano vinculado
      COALESCE(pc.codigo || ' — ' || pc.analitica, cc.codigo) AS conta_codigo,
      pc.grupo AS plano_grupo,
      ce.nome AS centro_nome, e.nome AS empresa_nome
    FROM finance.lancamentos l
    LEFT JOIN finance.plano_contas pc ON pc.id = l.plano_conta_id
    LEFT JOIN finance.contas_contabeis cc ON cc.id = l.conta_contabil_id
    LEFT JOIN finance.centros_custo   ce ON ce.id = l.centro_custo_id
    LEFT JOIN finance.empresas_grupo  e  ON e.id  = l.empresa_id
    WHERE l.tenant_id = v_tenant
  )
  SELECT jsonb_build_object(
    'data', v_dia,
    'kpis', jsonb_build_object(
      'despesas_dia', COALESCE((SELECT SUM(valor) FROM lj WHERE natureza='pagar'   AND vencimento=v_dia),0),
      'receitas_dia', COALESCE((SELECT SUM(valor) FROM lj WHERE natureza='receber' AND vencimento=v_dia),0),
      'saldo_dia',    COALESCE((SELECT SUM(valor) FROM lj WHERE natureza='receber' AND vencimento=v_dia),0)
                    - COALESCE((SELECT SUM(valor) FROM lj WHERE natureza='pagar'   AND vencimento=v_dia),0),
      'saldo_corrente', v_saldo_corrente
    ),
    'pagar', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.vencimento) FROM (
        SELECT id, descricao, fornecedor_nome, empresa_nome, conta_codigo, plano_grupo, centro_nome,
               valor, vencimento, status, reembolsavel
        FROM lj WHERE natureza='pagar'
          AND (vencimento <= v_dia OR status IN ('pendente','agendado','atrasado'))
      ) x), '[]'::jsonb),
    'receber', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.vencimento) FROM (
        SELECT id, descricao, cliente_id, empresa_nome, conta_codigo, plano_grupo, centro_nome,
               valor, vencimento, status, reembolso_de_id
        FROM lj WHERE natureza='receber'
          AND (vencimento <= v_dia OR status IN ('pendente','agendado','atrasado'))
      ) x), '[]'::jsonb)
  ) INTO v_out;

  RETURN v_out;
END $function$
;
