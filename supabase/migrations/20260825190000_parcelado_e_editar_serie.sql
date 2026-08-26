-- =====================================================================
-- Parcelado (divide o total) + editar a serie inteira
--
-- Filipe, 25/08: "haver uma sinalizacao de que aquela despesa e parcelada para
-- facilitar o cadastro (em vez de fazer 10 lancamentos, vc faz so um). mas isso
-- precisa estar claro na tela". Perguntei se o valor digitado e DIVIDIDO ou
-- REPETIDO, mostrando os dois totais, e ele escolheu dividir:
--   R$ 12.210 em 3x => 3 de R$ 4.070 (total R$ 12.210), e nao 3 de R$ 12.210.
--
-- Isso e uma coisa NOVA: repetir ja existia no checkbox "Despesa recorrente" e
-- continua igual, para aluguel e plano de saude. Agora sao dois modos:
--   recorrente = repete todo mes, sem data final (definicao dele)
--   parcelado  = divide um total em N vezes
--
-- Duas colunas aditivas guardam o que faltava para dividir direito: o total
-- (para a ultima parcela absorver a sobra de centavos) e o modo (para a tela
-- saber o que mostrar ao reabrir). Nada le essas colunas alem daqui.
--
-- E o "editar uma ou todas": as parcelas futuras JA existem como linhas, entao
-- editar em serie e um UPDATE nelas. O vencimento de proposito NAO propaga —
-- cada parcela tem a data dela, e propagar juntaria as 11 no mesmo dia.
-- =====================================================================

ALTER TABLE finance.recorrencias
  ADD COLUMN IF NOT EXISTS valor_total numeric(14,2),
  ADD COLUMN IF NOT EXISTS modo text NOT NULL DEFAULT 'recorrente';

DO $$ BEGIN
  ALTER TABLE finance.recorrencias
    ADD CONSTRAINT recorrencias_modo_check CHECK (modo IN ('recorrente','parcelado'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ── 1. criar: divide quando for parcelado ────────────────────────────
CREATE OR REPLACE FUNCTION public.cp_criar_lancamento(p_user_id uuid, p_payload jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public', 'finance', 'core'
AS $function$
DECLARE
  v_tenant uuid; v_id uuid; v_rec_id uuid; v_reembolso_id uuid;
  v_natureza finance.lancamento_natureza;
  v_valor numeric(14,2); v_venc date; v_recorrente boolean; v_reembolsavel boolean;
  v_modo text; v_parcelas int; v_total numeric(14,2); v_valor_parcela numeric(14,2);
BEGIN
  v_tenant := finance._cp_tenant(p_user_id);
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem tenant'; END IF;
  IF NOT finance._cp_pode(p_user_id, 'finance.contas_pagar.write') THEN
    RAISE EXCEPTION 'Sem permissão para lançar';
  END IF;

  v_natureza := COALESCE((p_payload->>'natureza')::finance.lancamento_natureza, 'pagar');
  v_valor := NULLIF(p_payload->>'valor','')::numeric;
  v_venc  := NULLIF(p_payload->>'vencimento','')::date;
  IF v_valor IS NULL OR v_valor <= 0 THEN RAISE EXCEPTION 'Valor é obrigatório'; END IF;
  IF v_venc IS NULL THEN RAISE EXCEPTION 'Vencimento é obrigatório'; END IF;
  IF COALESCE(p_payload->>'descricao','') = '' THEN RAISE EXCEPTION 'Descrição é obrigatória'; END IF;

  -- 'modo' é o campo novo. Payload antigo (só 'recorrente') continua valendo:
  -- sem modo, recorrente=true vira o modo 'recorrente' de sempre.
  v_modo := COALESCE(NULLIF(p_payload->>'modo',''),
                     CASE WHEN COALESCE((p_payload->>'recorrente')::boolean,false)
                          THEN 'recorrente' ELSE 'nenhum' END);
  v_parcelas := COALESCE(NULLIF(p_payload->>'num_parcelas','')::int, 0);
  v_recorrente := v_modo IN ('recorrente','parcelado');
  v_reembolsavel := COALESCE((p_payload->>'reembolsavel')::boolean, false);

  IF v_modo = 'parcelado' THEN
    IF v_parcelas < 2 THEN
      RAISE EXCEPTION 'Parcelado precisa de pelo menos 2 parcelas';
    END IF;
    -- O valor digitado é o TOTAL da compra. Guardamos ele e passamos a trabalhar
    -- com o valor da parcela: é ele que vai para a linha e para o fluxo de caixa.
    v_total := v_valor;
    v_valor_parcela := round(v_total / v_parcelas, 2);
    v_valor := v_valor_parcela;
  END IF;

  IF v_recorrente THEN
    INSERT INTO finance.recorrencias (tenant_id, valor_base, dia_vencimento, inicio,
      num_parcelas, reajuste_data, reajuste_indice, reajuste_percentual_estim,
      valor_total, modo)
    VALUES (v_tenant, v_valor,
      COALESCE(NULLIF(p_payload->>'dia_vencimento','')::smallint, EXTRACT(DAY FROM v_venc)::smallint),
      v_venc, v_parcelas,
      NULLIF(p_payload->>'reajuste_data','')::date, 'IPCA',
      NULLIF(p_payload->>'reajuste_percentual_estim','')::numeric,
      v_total, v_modo)
    RETURNING id INTO v_rec_id;
  END IF;

  INSERT INTO finance.lancamentos (
    tenant_id, natureza, tipo, status, empresa_id, fornecedor_nome, cliente_id,
    descricao, conta_contabil_id, plano_conta_id, centro_custo_id, valor, vencimento,
    recorrencia_id, parcela_numero, reembolsavel, numero_nota, forma_pagamento,
    conta_bancaria_id, anexo_url, observacoes, origem, created_by)
  VALUES (
    v_tenant, v_natureza, NULLIF(p_payload->>'tipo',''),
    COALESCE((p_payload->>'status')::finance.lancamento_status, 'pendente'),
    NULLIF(p_payload->>'empresa_id','')::uuid, NULLIF(p_payload->>'fornecedor_nome',''),
    NULLIF(p_payload->>'cliente_id','')::uuid,
    p_payload->>'descricao'
      || CASE WHEN v_modo = 'parcelado' THEN ' (1/' || v_parcelas || ')' ELSE '' END,
    NULLIF(p_payload->>'conta_contabil_id','')::uuid, NULLIF(p_payload->>'plano_conta_id','')::uuid,
    NULLIF(p_payload->>'centro_custo_id','')::uuid,
    v_valor, v_venc, v_rec_id, CASE WHEN v_recorrente THEN 1 ELSE NULL END,
    v_reembolsavel, NULLIF(p_payload->>'numero_nota',''), NULLIF(p_payload->>'forma_pagamento',''),
    NULLIF(p_payload->>'conta_bancaria_id','')::uuid, NULLIF(p_payload->>'anexo_url',''),
    NULLIF(p_payload->>'observacoes',''),
    CASE WHEN v_recorrente THEN 'recorrencia' ELSE 'manual' END::finance.lancamento_origem,
    p_user_id)
  RETURNING id INTO v_id;

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

  IF v_recorrente THEN
    PERFORM public.cp_gerar_parcelas(p_user_id, v_rec_id, 12);
  END IF;

  RETURN jsonb_build_object('id', v_id, 'recorrencia_id', v_rec_id,
                            'reembolso_id', v_reembolso_id,
                            'modo', v_modo, 'valor_parcela', v_valor);
END $function$;


-- ── 2. gerar parcelas: sobra de centavos na ultima ───────────────────
CREATE OR REPLACE FUNCTION public.cp_gerar_parcelas(
  p_user_id uuid, p_recorrencia_id uuid, p_horizonte_meses int DEFAULT 12)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public, finance, core AS $$
DECLARE
  v_tenant uuid; r finance.recorrencias%ROWTYPE;
  v_base finance.lancamentos%ROWTYPE;
  v_total int; v_n int; v_venc date; v_criadas int := 0;
  v_valor numeric(14,2); v_soma_anteriores numeric(14,2); v_desc text;
BEGIN
  v_tenant := finance._cp_tenant(p_user_id);
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem tenant'; END IF;

  SELECT * INTO r FROM finance.recorrencias WHERE id = p_recorrencia_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Recorrência não encontrada'; END IF;

  SELECT * INTO v_base FROM finance.lancamentos
   WHERE recorrencia_id = p_recorrencia_id AND tenant_id = v_tenant
   ORDER BY parcela_numero NULLS LAST LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lançamento base da recorrência não encontrado'; END IF;

  v_total := CASE WHEN r.num_parcelas > 0 THEN r.num_parcelas ELSE p_horizonte_meses END;

  -- A descricao da parcela 1 leva " (1/N)" quando e parcelado; as demais herdam
  -- o texto sem esse sufixo, para nao virar "Notebook (1/3) (2/3)".
  v_desc := regexp_replace(v_base.descricao, ' \((\d+)/(\d+)\)$', '');

  FOR v_n IN 2..v_total LOOP
    v_venc := (r.inicio + ((v_n - 1) || ' month')::interval)::date;

    -- Parcelado com sobra: 100,00 em 3x da 33,33 + 33,33 + 33,34. A ultima
    -- fecha a conta, senao o total cobrado nao bate com o que foi comprado.
    v_valor := r.valor_base;
    IF r.modo = 'parcelado' AND r.valor_total IS NOT NULL AND v_n = v_total THEN
      v_soma_anteriores := r.valor_base * (v_total - 1);
      v_valor := r.valor_total - v_soma_anteriores;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM finance.lancamentos
       WHERE recorrencia_id = p_recorrencia_id AND parcela_numero = v_n) THEN
      INSERT INTO finance.lancamentos (
        tenant_id, natureza, tipo, status, empresa_id, fornecedor_nome, cliente_id,
        descricao, conta_contabil_id, plano_conta_id, centro_custo_id, valor, vencimento,
        recorrencia_id, parcela_numero, reembolsavel, forma_pagamento,
        conta_bancaria_id, observacoes, origem, created_by)
      VALUES (
        v_base.tenant_id, v_base.natureza, v_base.tipo, 'pendente', v_base.empresa_id,
        v_base.fornecedor_nome, v_base.cliente_id,
        v_desc || CASE WHEN r.modo = 'parcelado' THEN ' (' || v_n || '/' || v_total || ')' ELSE '' END,
        v_base.conta_contabil_id, v_base.plano_conta_id, v_base.centro_custo_id,
        v_valor, v_venc,
        p_recorrencia_id, v_n, v_base.reembolsavel, v_base.forma_pagamento,
        v_base.conta_bancaria_id, v_base.observacoes, 'recorrencia', p_user_id);
      v_criadas := v_criadas + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('parcelas_criadas', v_criadas, 'total', v_total);
END $$;


-- ── 3. get_lancamento: a tela precisa saber que a linha e de uma serie ──
CREATE OR REPLACE FUNCTION public.cp_get_lancamento(p_user_id uuid, p_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public', 'finance', 'core'
AS $function$
DECLARE
  v_tenant uuid; v_row finance.lancamentos%ROWTYPE; v_rec finance.recorrencias%ROWTYPE;
  v_futuras int := 0;
BEGIN
  v_tenant := finance._cp_tenant(p_user_id);
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem tenant'; END IF;
  IF NOT finance._cp_pode(p_user_id, 'finance.contas_pagar.read') THEN
    RAISE EXCEPTION 'Sem permissão'; END IF;

  SELECT * INTO v_row FROM finance.lancamentos WHERE id = p_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lançamento não encontrado'; END IF;

  IF v_row.recorrencia_id IS NOT NULL THEN
    SELECT * INTO v_rec FROM finance.recorrencias WHERE id = v_row.recorrencia_id;
    -- Quantas ainda dá para mexer: as que vencem depois de hoje e nao foram
    -- baixadas. E esse numero que o dialogo mostra ("e as outras 7").
    SELECT count(*) INTO v_futuras FROM finance.lancamentos
     WHERE recorrencia_id = v_row.recorrencia_id AND tenant_id = v_tenant
       AND id <> p_id AND vencimento > CURRENT_DATE
       AND status NOT IN ('pago','recebido','cancelado');
  END IF;

  RETURN jsonb_build_object(
    'id', v_row.id, 'natureza', v_row.natureza, 'tipo', v_row.tipo,
    'status', v_row.status, 'fornecedor_nome', v_row.fornecedor_nome,
    'empresa_id', v_row.empresa_id, 'descricao', v_row.descricao,
    'conta_contabil_id', v_row.conta_contabil_id, 'plano_conta_id', v_row.plano_conta_id,
    'centro_custo_id', v_row.centro_custo_id, 'valor', v_row.valor,
    'vencimento', v_row.vencimento, 'reembolsavel', v_row.reembolsavel,
    'numero_nota', v_row.numero_nota, 'forma_pagamento', v_row.forma_pagamento,
    'conta_bancaria_id', v_row.conta_bancaria_id, 'observacoes', v_row.observacoes,
    'cliente_id', v_row.cliente_id, 'anexo_url', v_row.anexo_url,
    'baixa_data', v_row.baixa_data, 'baixa_valor', v_row.baixa_valor,
    'recorrencia_id', v_row.recorrencia_id,
    'parcela_numero', v_row.parcela_numero,
    'serie_modo', v_rec.modo,
    'serie_num_parcelas', v_rec.num_parcelas,
    'parcelas_futuras', v_futuras
  );
END $function$;


-- ── 4. editar: 'esta' (padrao) ou 'futuras' ──────────────────────────
CREATE OR REPLACE FUNCTION public.cp_editar_lancamento(p_user_id uuid, p_id uuid, p_payload jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public', 'finance', 'core'
AS $function$
DECLARE
  v_tenant uuid; v_row finance.lancamentos%ROWTYPE;
  v_valor numeric(14,2); v_venc date; v_escopo text; v_afetadas int := 0;
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

  -- Escopo vem DENTRO do payload de proposito. Um 4o parametro com DEFAULT
  -- criaria sobrecarga ambigua no PostgREST e quebraria as chamadas que ja
  -- existem na tela. Sem escopo, o comportamento e o de sempre.
  v_escopo := COALESCE(NULLIF(p_payload->>'escopo',''), 'esta');

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

  UPDATE finance.lancamentos SET
    valor = v_valor, vencimento = v_venc, updated_at = now()
  WHERE reembolso_de_id = p_id AND tenant_id = v_tenant AND status = 'pendente';

  IF v_escopo = 'futuras' AND v_row.recorrencia_id IS NOT NULL THEN
    -- Propaga o que descreve a despesa. NAO propaga:
    --   vencimento  -> cada parcela tem a data dela; propagar juntaria todas
    --                  no mesmo dia. Foi o medo que ele levantou em 11/08.
    --   numero_nota -> a nota fiscal e de uma parcela so.
    --   reembolsavel-> a linha-espelho de "a receber" so existe para a parcela
    --                  base; marcar as outras criaria despesa reembolsavel sem
    --                  a entrada correspondente.
    --   status/baixa-> estado individual de cada parcela.
    UPDATE finance.lancamentos SET
      fornecedor_nome   = NULLIF(p_payload->>'fornecedor_nome',''),
      empresa_id        = NULLIF(p_payload->>'empresa_id','')::uuid,
      conta_contabil_id = NULLIF(p_payload->>'conta_contabil_id','')::uuid,
      plano_conta_id    = NULLIF(p_payload->>'plano_conta_id','')::uuid,
      centro_custo_id   = NULLIF(p_payload->>'centro_custo_id','')::uuid,
      forma_pagamento   = NULLIF(p_payload->>'forma_pagamento',''),
      conta_bancaria_id = NULLIF(p_payload->>'conta_bancaria_id','')::uuid,
      observacoes       = NULLIF(p_payload->>'observacoes',''),
      valor             = v_valor,
      -- Mantem o sufixo "(3/10)" de cada uma: so o texto base muda.
      descricao = regexp_replace(p_payload->>'descricao', ' \((\d+)/(\d+)\)$', '')
                  || COALESCE(substring(descricao from ' \(\d+/\d+\)$'), ''),
      updated_at = now()
    WHERE recorrencia_id = v_row.recorrencia_id
      AND tenant_id = v_tenant
      AND id <> p_id
      AND vencimento > CURRENT_DATE
      AND status NOT IN ('pago','recebido','cancelado');
    GET DIAGNOSTICS v_afetadas = ROW_COUNT;

    -- As parcelas que ainda nao existem nascem com o valor novo.
    UPDATE finance.recorrencias
       SET valor_base = v_valor, updated_at = now()
     WHERE id = v_row.recorrencia_id AND tenant_id = v_tenant;
  END IF;

  RETURN jsonb_build_object('id', p_id, 'escopo', v_escopo, 'parcelas_afetadas', v_afetadas);
END;
$function$;
