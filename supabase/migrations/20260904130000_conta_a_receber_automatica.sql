-- =====================================================================
-- Conta a receber automatica, vencimento pelo caso, cancelamento em cadeia,
-- e RPCs da ficha do boleto
--
-- Filipe, 04/09, depois do teste de ponta a ponta:
--   "sobre o contas a receber, manda ver desse jeito automatico sim"
--   "Pode usarmos a data de vencimento como o constante no campo do caso?"
--   "preciso do arquivo PDF do boleto tambem"
--
-- O que estava errado:
--  1. A conta a receber so nascia quando alguem abria Contas a Pagar e Receber
--     (cp_sync_faturamento). Quem ia da nota direto ao boleto caia em
--     "conta a receber nao encontrada".
--  2. Nascia para nota ainda em 'processando_autorizacao'. A nota de teste 34
--     (Voa) gerou conta a receber e depois boleto REAL em cima de uma nota que
--     o escritorio achava cancelada.
--  3. Vencimento era o dia da emissao da nota (bn.created_at::date). O boleto
--     da Jucara venceu no mesmo dia. O campo do caso, pagamento_dia_mes,
--     nunca entrava.
--  4. Cancelar a nota devolvia os itens (PR #370) mas deixava a conta a
--     receber 'pendente' — e o botao de boleto continuava funcionando nela.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Vencimento pelo campo do caso
--
-- Regra: proximo dia <pagamento_dia_mes> DEPOIS da emissao. Emitiu dia 10
-- com dia 15 => vence dia 15 deste mes. Emitiu dia 15 com dia 15 => dia 15
-- do mes seguinte. Dia 31 em mes de 30 => ultimo dia do mes.
-- Sem dia no caso (920 casos ativos hoje; o Filipe disse que vai
-- padronizar) => 7 dias apos a emissao. Nunca mais "vence hoje".
-- ---------------------------------------------------------------------
-- Dia N do mes que comeca em p_mes, limitado ao ultimo dia do mes.
CREATE OR REPLACE FUNCTION finance._dia_no_mes(p_mes date, p_dia int)
RETURNS date
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT LEAST(p_mes + (p_dia - 1), (p_mes + interval '1 month - 1 day')::date);
$$;

CREATE OR REPLACE FUNCTION finance.vencimento_para_nota(p_nota_id uuid)
RETURNS date
LANGUAGE plpgsql
STABLE
SET search_path TO 'finance', 'contracts', 'public'
AS $$
DECLARE
  v_emissao date;
  v_dia int;
  v_cand date;
BEGIN
  SELECT bn.created_at::date,
         COALESCE(
           (SELECT cs.pagamento_dia_mes FROM contracts.casos cs WHERE cs.id = bn.caso_id),
           -- Nota do contrato inteiro: so vale se o contrato tem um caso ativo
           -- com dia definido. Dois casos com dias diferentes => sem regra.
           (SELECT cs.pagamento_dia_mes FROM contracts.casos cs
             WHERE cs.contrato_id = bn.contrato_id AND cs.ativo
               AND cs.pagamento_dia_mes IS NOT NULL
             GROUP BY cs.pagamento_dia_mes HAVING count(*) = (
               SELECT count(*) FROM contracts.casos c2
                WHERE c2.contrato_id = bn.contrato_id AND c2.ativo
                  AND c2.pagamento_dia_mes IS NOT NULL)
             LIMIT 1)
         )
    INTO v_emissao, v_dia
  FROM finance.billing_notes bn WHERE bn.id = p_nota_id;

  IF v_emissao IS NULL THEN RETURN NULL; END IF;
  IF v_dia IS NULL OR v_dia < 1 OR v_dia > 31 THEN
    RETURN v_emissao + 7;
  END IF;

  v_cand := finance._dia_no_mes(date_trunc('month', v_emissao)::date, v_dia);
  IF v_cand <= v_emissao THEN
    v_cand := finance._dia_no_mes((date_trunc('month', v_emissao) + interval '1 month')::date, v_dia);
  END IF;
  RETURN v_cand;
END $$;

-- ---------------------------------------------------------------------
-- 2. Criar a conta a receber de UMA nota (idempotente)
--
-- So para nota emitida E autorizada. Nota sem Focus (outros tipos de
-- documento, focus_ref nulo) continua entrando como antes.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION finance.criar_recebivel_da_nota(p_nota_id uuid, p_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'finance', 'contracts', 'crm', 'public'
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO finance.lancamentos (
    tenant_id, natureza, status, cliente_id, descricao, valor, vencimento,
    origem, origem_ref_id, created_by)
  SELECT
    bn.tenant_id, 'receber', 'pendente', ct.cliente_id,
    'Honorários — ' || COALESCE(cli.nome, 'cliente')
      || COALESCE(' (NF #' || bn.numero || ')', ''),
    COALESCE(NULLIF(bn.metadata->>'valor_total','')::numeric, 0),
    finance.vencimento_para_nota(bn.id),
    'faturamento', bn.id, p_user_id
  FROM finance.billing_notes bn
  LEFT JOIN contracts.contratos ct  ON ct.id  = bn.contrato_id
  LEFT JOIN crm.clientes        cli ON cli.id = ct.cliente_id
  WHERE bn.id = p_nota_id
    AND bn.status = 'gerado'
    AND (bn.focus_ref IS NULL OR bn.focus_status = 'autorizado')
    AND COALESCE(NULLIF(bn.metadata->>'valor_total','')::numeric, 0) > 0
    AND NOT EXISTS (
      SELECT 1 FROM finance.lancamentos l
      WHERE l.tenant_id = bn.tenant_id
        AND l.origem = 'faturamento'
        AND l.origem_ref_id = bn.id
        AND l.status <> 'cancelado')
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- ---------------------------------------------------------------------
-- 3. Gatilho: a nota virou 'autorizado' => conta a receber na hora.
--    Dispara pelo consultar-nfse (botao "Atualizar NFS-e" ou cron).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION finance.trg_nota_autorizada_cria_recebivel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'finance', 'public'
AS $$
BEGIN
  PERFORM finance.criar_recebivel_da_nota(NEW.id, NEW.created_by);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_nota_autorizada_cria_recebivel ON finance.billing_notes;
CREATE TRIGGER trg_nota_autorizada_cria_recebivel
AFTER UPDATE OF focus_status ON finance.billing_notes
FOR EACH ROW
WHEN (NEW.focus_status = 'autorizado' AND OLD.focus_status IS DISTINCT FROM 'autorizado')
EXECUTE FUNCTION finance.trg_nota_autorizada_cria_recebivel();

-- ---------------------------------------------------------------------
-- 4. O sync da tela passa a usar a mesma regra (idempotente, mesma funcao).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cp_sync_faturamento(p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public, finance, contracts, crm, core AS $$
DECLARE v_tenant uuid; v_criadas int := 0; r record;
BEGIN
  v_tenant := finance._cp_tenant(p_user_id);
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem tenant'; END IF;
  IF NOT finance._cp_pode(p_user_id, 'finance.contas_pagar.read') THEN
    RAISE EXCEPTION 'Sem permissão'; END IF;
  FOR r IN
    SELECT bn.id FROM finance.billing_notes bn
     WHERE bn.tenant_id = v_tenant
       AND bn.status = 'gerado'
       AND (bn.focus_ref IS NULL OR bn.focus_status = 'autorizado')
  LOOP
    IF finance.criar_recebivel_da_nota(r.id, p_user_id) IS NOT NULL THEN
      v_criadas := v_criadas + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('recebiveis_criados', v_criadas);
END $$;

-- ---------------------------------------------------------------------
-- 5. Cancelar a nota cancela a conta a receber.
--    Boleto ja registrado no Itau nao some daqui: e devolvido na resposta
--    para a tela avisar que precisa de baixa no banco.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bol_devolver_itens_da_nota(p_user_id uuid, p_nota_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'finance', 'operations', 'core'
AS $$
DECLARE
  v_tenant uuid;
  v_nota finance.billing_notes%ROWTYPE;
  v_itens int := 0;
  v_ts int := 0;
  v_lanc int := 0;
  v_boletos int := 0;
BEGIN
  SELECT tenant_id INTO v_tenant FROM core.tenant_users
   WHERE user_id = p_user_id AND status = 'ativo' LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem tenant'; END IF;

  SELECT * INTO v_nota FROM finance.billing_notes
   WHERE id = p_nota_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nota não encontrada'; END IF;

  UPDATE finance.billing_items bi
     SET status = 'em_revisao', updated_at = now(), updated_by = p_user_id
   WHERE bi.tenant_id = v_tenant
     AND bi.status = 'faturado'
     AND (
       (v_nota.caso_id IS NOT NULL AND bi.caso_id = v_nota.caso_id)
       OR (v_nota.caso_id IS NULL AND v_nota.contrato_id IS NOT NULL
           AND bi.contrato_id = v_nota.contrato_id)
     );
  GET DIAGNOSTICS v_itens = ROW_COUNT;

  UPDATE operations.timesheets t
     SET status = 'revisao', updated_at = now(), updated_by = p_user_id
   WHERE t.tenant_id = v_tenant
     AND t.status = 'aprovado'
     AND t.id IN (
       SELECT bi.origem_id FROM finance.billing_items bi
        WHERE bi.tenant_id = v_tenant
          AND bi.origem_tipo = 'timesheet'
          AND bi.status = 'em_revisao'
          AND (
            (v_nota.caso_id IS NOT NULL AND bi.caso_id = v_nota.caso_id)
            OR (v_nota.caso_id IS NULL AND v_nota.contrato_id IS NOT NULL
                AND bi.contrato_id = v_nota.contrato_id)
          )
     );
  GET DIAGNOSTICS v_ts = ROW_COUNT;

  -- Conta a receber da nota: cancela, a menos que ja tenha sido recebida.
  UPDATE finance.lancamentos l
     SET status = 'cancelado', updated_at = now()
   WHERE l.tenant_id = v_tenant
     AND l.origem = 'faturamento'
     AND l.origem_ref_id = p_nota_id
     AND l.status NOT IN ('cancelado', 'recebido', 'pago');
  GET DIAGNOSTICS v_lanc = ROW_COUNT;

  SELECT count(*) INTO v_boletos
    FROM finance.boletos b
    JOIN finance.lancamentos l ON l.id = b.lancamento_id
   WHERE l.tenant_id = v_tenant
     AND l.origem = 'faturamento'
     AND l.origem_ref_id = p_nota_id
     AND b.status = 'registrado';

  RETURN jsonb_build_object(
    'itens_devolvidos', v_itens,
    'horas_devolvidas', v_ts,
    'contas_canceladas', v_lanc,
    'boletos_registrados', v_boletos
  );
END $$;

-- ---------------------------------------------------------------------
-- 6. Acerto do que ja esta errado na base: conta a receber de nota
--    cancelada (a de teste da Voa, NF 34) deixa de estar pendente.
-- ---------------------------------------------------------------------
UPDATE finance.lancamentos l
   SET status = 'cancelado', updated_at = now()
  FROM finance.billing_notes bn
 WHERE bn.id = l.origem_ref_id
   AND l.origem = 'faturamento'
   AND bn.status = 'cancelado'
   AND l.status NOT IN ('cancelado', 'recebido', 'pago');

-- ---------------------------------------------------------------------
-- 7. RPCs da ficha do boleto (o PDF que o Filipe pediu)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION finance._boleto_resumo(b finance.boletos)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT jsonb_build_object(
    'id', b.id, 'status', b.status, 'valor', b.valor, 'vencimento', b.vencimento,
    'linha_digitavel', b.linha_digitavel, 'pix_copia_cola', b.pix_copia_cola,
    'codigo_barras', b.codigo_barras);
$$;

CREATE OR REPLACE FUNCTION public.bol_da_nota(p_user_id uuid, p_nota_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'finance', 'core'
AS $$
DECLARE v_tenant uuid; v_b finance.boletos%ROWTYPE;
BEGIN
  v_tenant := finance._cp_tenant(p_user_id);
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem tenant'; END IF;
  IF NOT finance._cp_pode(p_user_id, 'finance.contas_pagar.read') THEN
    RAISE EXCEPTION 'Sem permissão'; END IF;
  SELECT b.* INTO v_b
    FROM finance.boletos b
    JOIN finance.lancamentos l ON l.id = b.lancamento_id
   WHERE l.tenant_id = v_tenant
     AND l.origem = 'faturamento' AND l.origem_ref_id = p_nota_id
     AND b.status IN ('registrado', 'liquidado')
   ORDER BY b.created_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN finance._boleto_resumo(v_b);
END $$;

CREATE OR REPLACE FUNCTION public.bol_do_lancamento(p_user_id uuid, p_lancamento_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'finance', 'core'
AS $$
DECLARE v_tenant uuid; v_b finance.boletos%ROWTYPE;
BEGIN
  v_tenant := finance._cp_tenant(p_user_id);
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem tenant'; END IF;
  IF NOT finance._cp_pode(p_user_id, 'finance.contas_pagar.read') THEN
    RAISE EXCEPTION 'Sem permissão'; END IF;
  SELECT b.* INTO v_b FROM finance.boletos b
   WHERE b.tenant_id = v_tenant AND b.lancamento_id = p_lancamento_id
     AND b.status IN ('registrado', 'liquidado')
   ORDER BY b.created_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN finance._boleto_resumo(v_b);
END $$;

CREATE OR REPLACE FUNCTION public.bol_ficha(p_user_id uuid, p_boleto_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'finance', 'core', 'crm'
AS $$
DECLARE
  v_tenant uuid;
  v_b finance.boletos%ROWTYPE;
  v_l finance.lancamentos%ROWTYPE;
  v_cli crm.clientes%ROWTYPE;
  v_cfg finance.boleto_config%ROWTYPE;
  v_fiscal finance.tenant_focus_nfe_config%ROWTYPE;
  v_nota_numero int;
  v_instrucoes jsonb := '[]'::jsonb;
BEGIN
  v_tenant := finance._cp_tenant(p_user_id);
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem tenant'; END IF;
  IF NOT finance._cp_pode(p_user_id, 'finance.contas_pagar.read') THEN
    RAISE EXCEPTION 'Sem permissão'; END IF;

  SELECT * INTO v_b FROM finance.boletos WHERE id = p_boleto_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Boleto não encontrado'; END IF;
  SELECT * INTO v_l FROM finance.lancamentos WHERE id = v_b.lancamento_id;
  SELECT * INTO v_cli FROM crm.clientes WHERE id = v_l.cliente_id;
  SELECT * INTO v_cfg FROM finance.boleto_config WHERE tenant_id = v_tenant;
  SELECT * INTO v_fiscal FROM finance.tenant_focus_nfe_config WHERE tenant_id = v_tenant;
  SELECT bn.numero INTO v_nota_numero FROM finance.billing_notes bn
   WHERE bn.id = v_l.origem_ref_id AND v_l.origem = 'faturamento';

  IF v_cfg.dias_limite_pagamento IS NOT NULL THEN
    v_instrucoes := v_instrucoes || to_jsonb(
      'Não receber após ' || v_cfg.dias_limite_pagamento || ' dias do vencimento.');
  END IF;
  IF v_cfg.juros_ativo AND v_cfg.juros_percentual_mes IS NOT NULL THEN
    v_instrucoes := v_instrucoes || to_jsonb(
      'Após o vencimento, juros de ' || v_cfg.juros_percentual_mes || '% ao mês.');
  END IF;
  IF v_cfg.multa_tipo = 'percentual' AND v_cfg.multa_percentual IS NOT NULL THEN
    v_instrucoes := v_instrucoes || to_jsonb('Após o vencimento, multa de ' || v_cfg.multa_percentual || '%.');
  ELSIF v_cfg.multa_tipo = 'valor' AND v_cfg.multa_valor IS NOT NULL THEN
    v_instrucoes := v_instrucoes || to_jsonb('Após o vencimento, multa de R$ ' || v_cfg.multa_valor || '.');
  END IF;

  RETURN jsonb_build_object(
    'boleto', jsonb_build_object(
      'id', v_b.id, 'nosso_numero', v_b.nosso_numero, 'seu_numero', v_b.seu_numero,
      'valor', v_b.valor, 'vencimento', v_b.vencimento, 'data_emissao', v_b.created_at::date,
      'status', v_b.status, 'linha_digitavel', v_b.linha_digitavel,
      'codigo_barras', v_b.codigo_barras, 'pix_copia_cola', v_b.pix_copia_cola),
    'pagador', jsonb_build_object(
      'nome', v_cli.nome,
      'documento', regexp_replace(COALESCE(v_cli.cnpj, ''), '\D', '', 'g'),
      'logradouro', trim(COALESCE(v_cli.rua, '') || ', ' || COALESCE(v_cli.numero, '')),
      'bairro', COALESCE(v_cli.bairro, ''), 'cidade', COALESCE(v_cli.cidade, ''),
      'uf', COALESCE(v_cli.estado, ''), 'cep', regexp_replace(COALESCE(v_cli.cep, ''), '\D', '', 'g')),
    'beneficiario', jsonb_build_object(
      'cnpj', regexp_replace(COALESCE(v_fiscal.cnpj, ''), '\D', '', 'g'),
      -- id_beneficiario do Itau = agencia(4) + conta(7) + digito(1)
      'agencia', substr(v_cfg.id_beneficiario, 1, 4),
      'conta', ltrim(substr(v_cfg.id_beneficiario, 5, 7), '0') || '-' || substr(v_cfg.id_beneficiario, 12, 1),
      'carteira', v_cfg.codigo_carteira, 'especie', v_cfg.codigo_especie),
    'descricao', v_l.descricao,
    'nota_numero', v_nota_numero,
    'instrucoes', v_instrucoes
  );
END $$;

REVOKE ALL ON FUNCTION public.bol_da_nota(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bol_do_lancamento(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bol_ficha(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bol_da_nota(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bol_do_lancamento(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bol_ficha(uuid, uuid) TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';
