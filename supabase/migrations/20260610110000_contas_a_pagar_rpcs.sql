-- =====================================================================
-- MÓDULO CONTAS A PAGAR / FLUXO DE CAIXA — RPCs (M2)
-- Depende de: 20260610100000_contas_a_pagar_fluxo_caixa.sql
--
-- Padrão (igual às RPCs do projeto): SECURITY DEFINER, search_path explícito,
-- resolve tenant via core.tenant_users, RETURNS jsonb, GRANT EXECUTE, NOTIFY.
-- Isolamento por tenant é obrigatório; writes checam finance.contas_pagar.write
-- (sócios/administrativo já recebem todas as chaves via get_user_permissions).
-- =====================================================================

-- ── Helpers internos (tenant + permissão) ────────────────────────────
CREATE OR REPLACE FUNCTION finance._cp_tenant(p_user_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO public, core AS $$
  SELECT tu.tenant_id FROM core.tenant_users tu
   WHERE tu.user_id = p_user_id AND tu.status = 'ativo' LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION finance._cp_pode(p_user_id uuid, p_chave text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO public, core, people AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.get_user_permissions(p_user_id) gp
    WHERE gp.permission_key = p_chave
  );
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 1. LISTAS DE APOIO (dropdowns do form)
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cp_listas(p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public, finance, core AS $$
DECLARE v_tenant uuid; v_out jsonb;
BEGIN
  v_tenant := finance._cp_tenant(p_user_id);
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem tenant'; END IF;
  IF NOT finance._cp_pode(p_user_id, 'finance.contas_pagar.read') THEN
    RAISE EXCEPTION 'Sem permissão para o módulo financeiro';
  END IF;

  SELECT jsonb_build_object(
    'centros_custo', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'nome', nome) ORDER BY nome)
       FROM finance.centros_custo WHERE tenant_id = v_tenant AND ativo), '[]'::jsonb),
    'contas_contabeis', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'codigo', codigo, 'nome', nome, 'centro_custo_id', centro_custo_id) ORDER BY codigo)
       FROM finance.contas_contabeis WHERE tenant_id = v_tenant AND ativo), '[]'::jsonb),
    'empresas', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'nome', nome) ORDER BY nome)
       FROM finance.empresas_grupo WHERE tenant_id = v_tenant AND ativo), '[]'::jsonb),
    'contas_bancarias', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'banco', banco, 'descricao', descricao, 'saldo_abertura', saldo_abertura, 'saldo_abertura_data', saldo_abertura_data) ORDER BY banco)
       FROM finance.contas_bancarias WHERE tenant_id = v_tenant AND ativo), '[]'::jsonb)
  ) INTO v_out;
  RETURN v_out;
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- 2. CRIAR LANÇAMENTO (trata recorrência + reembolsável)
--    p_payload: { natureza, tipo, status?, empresa_id?, fornecedor_nome?,
--      cliente_id?, descricao, conta_contabil_id?, centro_custo_id?, valor,
--      vencimento, numero_nota?, forma_pagamento?, conta_bancaria_id?,
--      anexo_url?, observacoes?, reembolsavel?, recorrente?, num_parcelas?,
--      dia_vencimento?, reajuste_data?, reajuste_percentual_estim? }
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cp_criar_lancamento(p_user_id uuid, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public, finance, core AS $$
DECLARE
  v_tenant uuid; v_id uuid; v_rec_id uuid; v_reembolso_id uuid;
  v_natureza finance.lancamento_natureza;
  v_valor numeric(14,2); v_venc date; v_recorrente boolean; v_reembolsavel boolean;
BEGIN
  v_tenant := finance._cp_tenant(p_user_id);
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem tenant'; END IF;
  IF NOT finance._cp_pode(p_user_id, 'finance.contas_pagar.write') THEN
    RAISE EXCEPTION 'Sem permissão para lançar';
  END IF;

  -- Validações mínimas (obrigatórios da spec)
  v_natureza := COALESCE((p_payload->>'natureza')::finance.lancamento_natureza, 'pagar');
  v_valor := NULLIF(p_payload->>'valor','')::numeric;
  v_venc  := NULLIF(p_payload->>'vencimento','')::date;
  IF v_valor IS NULL OR v_valor <= 0 THEN RAISE EXCEPTION 'Valor é obrigatório'; END IF;
  IF v_venc IS NULL THEN RAISE EXCEPTION 'Vencimento é obrigatório'; END IF;
  IF COALESCE(p_payload->>'descricao','') = '' THEN RAISE EXCEPTION 'Descrição é obrigatória'; END IF;

  v_recorrente  := COALESCE((p_payload->>'recorrente')::boolean, false);
  v_reembolsavel := COALESCE((p_payload->>'reembolsavel')::boolean, false);

  -- Recorrência (cria o cabeçalho; parcelas geradas por cp_gerar_parcelas)
  IF v_recorrente THEN
    INSERT INTO finance.recorrencias (tenant_id, valor_base, dia_vencimento, inicio,
      num_parcelas, reajuste_data, reajuste_indice, reajuste_percentual_estim)
    VALUES (v_tenant, v_valor,
      COALESCE(NULLIF(p_payload->>'dia_vencimento','')::smallint, EXTRACT(DAY FROM v_venc)::smallint),
      v_venc,
      COALESCE(NULLIF(p_payload->>'num_parcelas','')::int, 0),
      NULLIF(p_payload->>'reajuste_data','')::date, 'IPCA',
      NULLIF(p_payload->>'reajuste_percentual_estim','')::numeric)
    RETURNING id INTO v_rec_id;
  END IF;

  -- Lançamento base
  INSERT INTO finance.lancamentos (
    tenant_id, natureza, tipo, status, empresa_id, fornecedor_nome, cliente_id,
    descricao, conta_contabil_id, centro_custo_id, valor, vencimento,
    recorrencia_id, parcela_numero, reembolsavel, numero_nota, forma_pagamento,
    conta_bancaria_id, anexo_url, observacoes, origem, created_by)
  VALUES (
    v_tenant, v_natureza, NULLIF(p_payload->>'tipo',''),
    COALESCE((p_payload->>'status')::finance.lancamento_status, 'pendente'),
    NULLIF(p_payload->>'empresa_id','')::uuid, NULLIF(p_payload->>'fornecedor_nome',''),
    NULLIF(p_payload->>'cliente_id','')::uuid, p_payload->>'descricao',
    NULLIF(p_payload->>'conta_contabil_id','')::uuid, NULLIF(p_payload->>'centro_custo_id','')::uuid,
    v_valor, v_venc, v_rec_id, CASE WHEN v_recorrente THEN 1 ELSE NULL END,
    v_reembolsavel, NULLIF(p_payload->>'numero_nota',''), NULLIF(p_payload->>'forma_pagamento',''),
    NULLIF(p_payload->>'conta_bancaria_id','')::uuid, NULLIF(p_payload->>'anexo_url',''),
    NULLIF(p_payload->>'observacoes',''),
    CASE WHEN v_recorrente THEN 'recorrencia' ELSE 'manual' END::finance.lancamento_origem,
    p_user_id)
  RETURNING id INTO v_id;

  -- Reembolsável: gera a PREVISÃO DE ENTRADA vinculada (decisão da spec).
  IF v_reembolsavel AND v_natureza = 'pagar' THEN
    INSERT INTO finance.lancamentos (
      tenant_id, natureza, status, empresa_id, descricao, valor, vencimento,
      reembolso_de_id, origem, created_by)
    VALUES (
      v_tenant, 'receber', 'pendente', NULLIF(p_payload->>'empresa_id','')::uuid,
      'Reembolso: ' || (p_payload->>'descricao'), v_valor, v_venc,
      v_id, 'reembolso', p_user_id)
    RETURNING id INTO v_reembolso_id;
  END IF;

  -- Gera parcelas se recorrente
  IF v_recorrente THEN
    PERFORM public.cp_gerar_parcelas(p_user_id, v_rec_id, 12);
  END IF;

  RETURN jsonb_build_object('id', v_id, 'recorrencia_id', v_rec_id, 'reembolso_id', v_reembolso_id);
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- 3. GERAR PARCELAS DA RECORRÊNCIA (idempotente)
--    N>0: gera N parcelas. N=0: gera até p_horizonte_meses à frente.
--    Não duplica: usa (recorrencia_id, parcela_numero) como chave lógica.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cp_gerar_parcelas(
  p_user_id uuid, p_recorrencia_id uuid, p_horizonte_meses int DEFAULT 12)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public, finance, core AS $$
DECLARE
  v_tenant uuid; r finance.recorrencias%ROWTYPE;
  v_base finance.lancamentos%ROWTYPE;
  v_total int; v_n int; v_venc date; v_criadas int := 0;
BEGIN
  v_tenant := finance._cp_tenant(p_user_id);
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem tenant'; END IF;

  SELECT * INTO r FROM finance.recorrencias WHERE id = p_recorrencia_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Recorrência não encontrada'; END IF;

  -- Lançamento "modelo" = a 1ª parcela (parcela_numero=1) p/ copiar a classificação
  SELECT * INTO v_base FROM finance.lancamentos
   WHERE recorrencia_id = p_recorrencia_id AND tenant_id = v_tenant
   ORDER BY parcela_numero NULLS LAST LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lançamento base da recorrência não encontrado'; END IF;

  v_total := CASE WHEN r.num_parcelas > 0 THEN r.num_parcelas ELSE p_horizonte_meses END;

  FOR v_n IN 2..v_total LOOP
    v_venc := (r.inicio + ((v_n - 1) || ' month')::interval)::date;
    -- idempotência: só insere se ainda não existe essa parcela
    IF NOT EXISTS (
      SELECT 1 FROM finance.lancamentos
       WHERE recorrencia_id = p_recorrencia_id AND parcela_numero = v_n) THEN
      INSERT INTO finance.lancamentos (
        tenant_id, natureza, tipo, status, empresa_id, fornecedor_nome, cliente_id,
        descricao, conta_contabil_id, centro_custo_id, valor, vencimento,
        recorrencia_id, parcela_numero, reembolsavel, forma_pagamento,
        conta_bancaria_id, observacoes, origem, created_by)
      VALUES (
        v_base.tenant_id, v_base.natureza, v_base.tipo, 'pendente', v_base.empresa_id,
        v_base.fornecedor_nome, v_base.cliente_id, v_base.descricao,
        v_base.conta_contabil_id, v_base.centro_custo_id, r.valor_base, v_venc,
        p_recorrencia_id, v_n, v_base.reembolsavel, v_base.forma_pagamento,
        v_base.conta_bancaria_id, v_base.observacoes, 'recorrencia', p_user_id);
      v_criadas := v_criadas + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('parcelas_criadas', v_criadas, 'total', v_total);
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- 4. DAR BAIXA (paga/recebida/cancelada) — sem conciliação
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cp_dar_baixa(
  p_user_id uuid, p_id uuid, p_status text,
  p_data date DEFAULT NULL, p_valor numeric DEFAULT NULL, p_conta_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public, finance, core AS $$
DECLARE v_tenant uuid; v_row finance.lancamentos%ROWTYPE;
BEGIN
  v_tenant := finance._cp_tenant(p_user_id);
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem tenant'; END IF;
  IF NOT finance._cp_pode(p_user_id, 'finance.contas_pagar.write') THEN
    RAISE EXCEPTION 'Sem permissão'; END IF;

  SELECT * INTO v_row FROM finance.lancamentos WHERE id = p_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lançamento não encontrado'; END IF;

  UPDATE finance.lancamentos SET
    status = p_status::finance.lancamento_status,
    baixa_data = COALESCE(p_data, CURRENT_DATE),
    baixa_valor = COALESCE(p_valor, valor),
    baixa_conta_id = COALESCE(p_conta_id, conta_bancaria_id),
    updated_at = now()
  WHERE id = p_id AND tenant_id = v_tenant;

  RETURN jsonb_build_object('id', p_id, 'status', p_status);
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- 5. REAGENDAR (move o vencimento, guarda o anterior)
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cp_reagendar(p_user_id uuid, p_id uuid, p_nova_data date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public, finance, core AS $$
DECLARE v_tenant uuid; v_old date;
BEGIN
  v_tenant := finance._cp_tenant(p_user_id);
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem tenant'; END IF;
  IF NOT finance._cp_pode(p_user_id, 'finance.contas_pagar.write') THEN
    RAISE EXCEPTION 'Sem permissão'; END IF;
  IF p_nova_data IS NULL THEN RAISE EXCEPTION 'Nova data é obrigatória'; END IF;

  SELECT vencimento INTO v_old FROM finance.lancamentos WHERE id = p_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lançamento não encontrado'; END IF;

  UPDATE finance.lancamentos SET
    reagendado_de = v_old, vencimento = p_nova_data,
    status = 'remanejado', updated_at = now()
  WHERE id = p_id AND tenant_id = v_tenant;

  RETURN jsonb_build_object('id', p_id, 'de', v_old, 'para', p_nova_data);
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- 6. SALDO INICIAL MANUAL da conta bancária
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cp_set_saldo_conta(
  p_user_id uuid, p_conta_id uuid, p_saldo numeric, p_data date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public, finance, core AS $$
DECLARE v_tenant uuid;
BEGIN
  v_tenant := finance._cp_tenant(p_user_id);
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem tenant'; END IF;
  IF NOT finance._cp_pode(p_user_id, 'finance.contas_pagar.write') THEN
    RAISE EXCEPTION 'Sem permissão'; END IF;

  UPDATE finance.contas_bancarias SET
    saldo_abertura = p_saldo, saldo_abertura_data = COALESCE(p_data, CURRENT_DATE), updated_at = now()
  WHERE id = p_conta_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conta bancária não encontrada'; END IF;

  RETURN jsonb_build_object('id', p_conta_id, 'saldo', p_saldo);
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- 7. ROTINA DIÁRIA (dashboard: KPIs + listas pagar/receber do dia)
--    Receber = lançamentos manuais natureza='receber'. A integração com o
--    faturamento (honorários a receber) entra em passo separado (M2.5),
--    após confirmar o shape das tabelas de billing — não chuto schema.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cp_rotina_diaria(p_user_id uuid, p_data date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public, finance, core AS $$
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
    SELECT l.*, cc.codigo AS conta_codigo, ce.nome AS centro_nome, e.nome AS empresa_nome
    FROM finance.lancamentos l
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
        SELECT id, descricao, fornecedor_nome, empresa_nome, conta_codigo, centro_nome,
               valor, vencimento, status, reembolsavel
        FROM lj WHERE natureza='pagar'
          AND (vencimento <= v_dia OR status IN ('pendente','agendado','atrasado'))
      ) x), '[]'::jsonb),
    'receber', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.vencimento) FROM (
        SELECT id, descricao, cliente_id, empresa_nome, conta_codigo, centro_nome,
               valor, vencimento, status, reembolso_de_id
        FROM lj WHERE natureza='receber'
          AND (vencimento <= v_dia OR status IN ('pendente','agendado','atrasado'))
      ) x), '[]'::jsonb)
  ) INTO v_out;

  RETURN v_out;
END $$;

-- ── GRANTS ───────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.cp_listas(uuid)                              TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cp_criar_lancamento(uuid, jsonb)             TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cp_gerar_parcelas(uuid, uuid, int)           TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cp_dar_baixa(uuid, uuid, text, date, numeric, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cp_reagendar(uuid, uuid, date)               TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cp_set_saldo_conta(uuid, uuid, numeric, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cp_rotina_diaria(uuid, date)                 TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
