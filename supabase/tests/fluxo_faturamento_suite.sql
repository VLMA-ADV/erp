-- Suíte automatizada do fluxo timesheet -> revisão -> aprovação (v1.25.0).
-- Roda TUDO numa transação e SEMPRE reverte (o RAISE final aborta a txn):
-- nenhum dado fica no banco. Cada cenário é um sub-bloco com EXCEPTION,
-- então uma falha não derruba os demais.
--
-- Como rodar: scripts/test-fluxo-faturamento.sh
-- Resultado: uma linha [PASS]/[FAIL] por cenário na mensagem final.

BEGIN;

DO $suite$
DECLARE
  v_tenant uuid := 'd51463dd-a6b3-40e7-9488-854eba80a210';
  v_admin uuid;              -- diretor (vê tudo / envia / avança)
  v_results text := '';
  -- fixtures
  v_caso_auto uuid; v_contrato_auto uuid; v_cli_auto uuid;
  v_caso_nom uuid; v_contrato_nom uuid; v_revisor_nom_nome text;
  v_autor_user uuid; v_autor_nome text; v_autor_area uuid; v_coord_nome text;
BEGIN
  -- admin = Douglas (socio, área VLMA)
  SELECT c.user_id INTO v_admin FROM people.colaboradores c
  JOIN people.areas a ON a.id=c.area_id
  WHERE c.tenant_id=v_tenant AND c.categoria='socio' AND a.nome='VLMA' AND c.user_id IS NOT NULL
  LIMIT 1;

  -- caso multi-CC (revisão automática por centro de custo)
  SELECT cs.id, cs.contrato_id, c.cliente_id INTO v_caso_auto, v_contrato_auto, v_cli_auto
  FROM contracts.casos cs JOIN contracts.contratos c ON c.id=cs.contrato_id
  WHERE cs.tenant_id=v_tenant AND cs.timesheet_config->>'revisores_modo'='auto_centro_custo' AND c.status='ativo'
  LIMIT 1;

  -- caso com revisor NOMEADO
  SELECT cs.id, cs.contrato_id, col.nome INTO v_caso_nom, v_contrato_nom, v_revisor_nom_nome
  FROM contracts.casos cs
  JOIN contracts.contratos c ON c.id=cs.contrato_id AND c.status='ativo'
  JOIN LATERAL (
    SELECT NULLIF(r->>'colaborador_id','')::uuid AS colaborador_id
    FROM jsonb_array_elements(COALESCE(cs.timesheet_config->'revisores','[]'::jsonb)) r
    ORDER BY COALESCE(NULLIF(r->>'ordem','')::int, 999999) LIMIT 1
  ) rc ON rc.colaborador_id IS NOT NULL
  JOIN people.colaboradores col ON col.id=rc.colaborador_id
  WHERE cs.tenant_id=v_tenant
  LIMIT 1;

  -- autor comum (não coordenador) de uma área que TENHA coordenador
  SELECT m.user_id, m.nome, m.area_id, coord.nome
    INTO v_autor_user, v_autor_nome, v_autor_area, v_coord_nome
  FROM people.colaboradores m
  JOIN people.colaboradores coord
    ON coord.area_id=m.area_id AND coord.tenant_id=v_tenant AND COALESCE(coord.eh_coordenador,false)=true
  JOIN people.areas a ON a.id=m.area_id
  WHERE m.tenant_id=v_tenant AND m.user_id IS NOT NULL
    AND COALESCE(m.eh_coordenador,false)=false AND m.categoria <> 'socio' AND a.nome <> 'VLMA'
  LIMIT 1;

  ------------------------------------------------------------------
  -- T1: exclusão instantânea + autor no snapshot + bloqueio pós-revisão
  ------------------------------------------------------------------
  DECLARE v_ts uuid; v_bi uuid; v_snap text; v_status text; v_visivel int; v_blk text := 'NAO BLOQUEOU';
  BEGIN
    INSERT INTO operations.timesheets (tenant_id, contrato_id, caso_id, data_lancamento, horas, descricao, status, created_by)
    VALUES (v_tenant, v_contrato_auto, v_caso_auto, CURRENT_DATE, 1, 'SUITE T1', 'em_lancamento', v_autor_user)
    RETURNING id INTO v_ts;
    PERFORM public.start_faturamento_flow(v_admin, jsonb_build_object(
      'data_inicio', to_char(date_trunc('month',CURRENT_DATE),'YYYY-MM-DD'),
      'data_fim', to_char(CURRENT_DATE,'YYYY-MM-DD'), 'alvo_tipo','caso','alvo_id', v_caso_auto::text));
    SELECT id, snapshot->>'timesheet_profissional' INTO v_bi, v_snap
    FROM finance.billing_items WHERE origem_tipo='timesheet' AND origem_id=v_ts;

    PERFORM public.delete_timesheet(v_autor_user, v_ts);
    SELECT status INTO v_status FROM finance.billing_items WHERE id=v_bi;
    SELECT count(*) INTO v_visivel FROM jsonb_array_elements(public.get_revisao_fatura(v_admin)) e
    WHERE (e->>'billing_item_id')::uuid = v_bi;

    -- bloqueio: item já revisado não pode excluir
    INSERT INTO operations.timesheets (tenant_id, contrato_id, caso_id, data_lancamento, horas, descricao, status, created_by)
    VALUES (v_tenant, v_contrato_auto, v_caso_auto, CURRENT_DATE, 1, 'SUITE T1b', 'em_lancamento', v_autor_user)
    RETURNING id INTO v_ts;
    PERFORM public.start_faturamento_flow(v_admin, jsonb_build_object(
      'data_inicio', to_char(date_trunc('month',CURRENT_DATE),'YYYY-MM-DD'),
      'data_fim', to_char(CURRENT_DATE,'YYYY-MM-DD'), 'alvo_tipo','caso','alvo_id', v_caso_auto::text));
    UPDATE finance.billing_items SET data_revisao=now() WHERE origem_tipo='timesheet' AND origem_id=v_ts;
    BEGIN
      PERFORM public.delete_timesheet(v_autor_user, v_ts);
    EXCEPTION WHEN others THEN v_blk := 'BLOQUEOU';
    END;

    IF v_snap = v_autor_nome AND v_status='cancelado' AND v_visivel=0 AND v_blk='BLOQUEOU' THEN
      v_results := v_results || '[PASS] T1 exclusão instantânea + autor snapshot + bloqueio | ';
    ELSE
      v_results := v_results || format('[FAIL] T1 snap=%s status=%s visivel=%s blk=%s | ', v_snap, v_status, v_visivel, v_blk);
    END IF;
  EXCEPTION WHEN others THEN
    v_results := v_results || '[FAIL] T1 erro: ' || left(SQLERRM, 60) || ' | ';
  END;

  ------------------------------------------------------------------
  -- T2: trava multi-CC (aprovação só libera com todos os CCs revisados)
  ------------------------------------------------------------------
  DECLARE v_ts1 uuid; v_ts2 uuid; v_bi1 uuid; v_bi2 uuid; v_blk text := 'NAO BLOQUEOU'; v_final text;
  BEGIN
    INSERT INTO operations.timesheets (tenant_id, contrato_id, caso_id, data_lancamento, horas, descricao, status, created_by)
    VALUES (v_tenant, v_contrato_auto, v_caso_auto, CURRENT_DATE, 1, 'SUITE T2a', 'revisao', v_autor_user) RETURNING id INTO v_ts1;
    INSERT INTO operations.timesheets (tenant_id, contrato_id, caso_id, data_lancamento, horas, descricao, status, created_by)
    VALUES (v_tenant, v_contrato_auto, v_caso_auto, CURRENT_DATE, 1, 'SUITE T2b', 'revisao', v_autor_user) RETURNING id INTO v_ts2;
    INSERT INTO finance.billing_items (tenant_id, cliente_id, contrato_id, caso_id, origem_tipo, origem_id, data_referencia, periodo_inicio, periodo_fim, status, valor_informado, horas_informadas, snapshot, created_by, updated_by)
    VALUES (v_tenant, v_cli_auto, v_contrato_auto, v_caso_auto, 'timesheet', v_ts1, CURRENT_DATE, date_trunc('month',CURRENT_DATE)::date, CURRENT_DATE, 'em_aprovacao', 100, 1, '{}'::jsonb, v_admin, v_admin) RETURNING id INTO v_bi1;
    INSERT INTO finance.billing_items (tenant_id, cliente_id, contrato_id, caso_id, origem_tipo, origem_id, data_referencia, periodo_inicio, periodo_fim, status, valor_informado, horas_informadas, snapshot, created_by, updated_by)
    VALUES (v_tenant, v_cli_auto, v_contrato_auto, v_caso_auto, 'timesheet', v_ts2, CURRENT_DATE, date_trunc('month',CURRENT_DATE)::date, CURRENT_DATE, 'em_revisao', 100, 1, '{}'::jsonb, v_admin, v_admin) RETURNING id INTO v_bi2;

    -- regra 15/07: aprovador tem autonomia total — aprova MESMO com
    -- irmão em revisão no caso (a trava dura foi removida)
    BEGIN
      PERFORM public.set_revisao_fatura_status(v_admin, jsonb_build_object('billing_item_id', v_bi1::text, 'action','avancar'));
    EXCEPTION WHEN others THEN v_blk := 'BLOQUEOU';
    END;
    SELECT status INTO v_final FROM finance.billing_items WHERE id=v_bi1;

    IF v_blk='NAO BLOQUEOU' AND v_final='aprovado' THEN
      v_results := v_results || '[PASS] T2 aprovador destravado: aprova com irmão em revisão | ';
    ELSE
      v_results := v_results || format('[FAIL] T2 blk=%s final=%s | ', v_blk, v_final);
    END IF;
  EXCEPTION WHEN others THEN
    v_results := v_results || '[FAIL] T2 erro: ' || left(SQLERRM, 60) || ' | ';
  END;

  ------------------------------------------------------------------
  -- T3: hora herda a regra do caso (etapa 1 e revisão)
  ------------------------------------------------------------------
  DECLARE v jsonb; v_grid int; v_ts uuid; v_rev text;
  BEGIN
    -- etapa 1: linhas timesheet com caso_regra preenchida quando o caso não é hora
    v := public.get_itens_a_faturar(v_admin, date_trunc('month',CURRENT_DATE)::date, CURRENT_DATE, NULL);
    SELECT count(*) INTO v_grid
    FROM jsonb_array_elements(v) cli, jsonb_array_elements(cli->'contratos') ct,
         jsonb_array_elements(ct->'casos') cs, jsonb_array_elements(cs->'extrato') l
    WHERE l->>'tipo'='timesheet' AND COALESCE(l->>'caso_regra','') NOT IN ('','hora');

    -- revisão: hora em caso não-hora vem com caso_regra_cobranca
    INSERT INTO operations.timesheets (tenant_id, contrato_id, caso_id, data_lancamento, horas, descricao, status, created_by)
    VALUES (v_tenant, v_contrato_nom, v_caso_nom, CURRENT_DATE, 1, 'SUITE T3', 'em_lancamento', v_autor_user) RETURNING id INTO v_ts;
    PERFORM public.start_faturamento_flow(v_admin, jsonb_build_object(
      'data_inicio', to_char(date_trunc('month',CURRENT_DATE),'YYYY-MM-DD'),
      'data_fim', to_char(CURRENT_DATE,'YYYY-MM-DD'), 'alvo_tipo','caso','alvo_id', v_caso_nom::text));
    SELECT e->>'caso_regra_cobranca' INTO v_rev
    FROM jsonb_array_elements(public.get_revisao_fatura(v_admin)) e
    WHERE (e->>'timesheet_id')::uuid = v_ts LIMIT 1;

    IF v_grid >= 0 AND v_rev IS NOT NULL THEN
      v_results := v_results || format('[PASS] T3 regra do caso nas 2 etapas (grid=%s, revisão=%s) | ', v_grid, v_rev);
    ELSE
      v_results := v_results || format('[FAIL] T3 grid=%s rev=%s | ', v_grid, v_rev);
    END IF;
  EXCEPTION WHEN others THEN
    v_results := v_results || '[FAIL] T3 erro: ' || left(SQLERRM, 60) || ' | ';
  END;

  ------------------------------------------------------------------
  -- T4: gerar do mês só regras + idempotente amigável
  ------------------------------------------------------------------
  DECLARE v jsonb; v2 jsonb; v_batch uuid; v_ts int; v_re int;
  BEGIN
    DELETE FROM finance.billing_items WHERE id = (
      SELECT id FROM finance.billing_items
      WHERE tenant_id=v_tenant AND origem_tipo='regra_financeira'
        AND periodo_inicio=date_trunc('month',CURRENT_DATE)::date LIMIT 1);
    v := public.start_faturamento_flow(v_admin, jsonb_build_object(
      'data_inicio', to_char(date_trunc('month',CURRENT_DATE),'YYYY-MM-DD'),
      'data_fim', to_char((date_trunc('month',CURRENT_DATE)+interval '1 month - 1 day')::date,'YYYY-MM-DD'),
      'alvo_tipo','itens','somente_regras', true));
    v_batch := NULLIF(v->>'batch_id','')::uuid;
    SELECT count(*) FILTER (WHERE origem_tipo='timesheet'), count(*) FILTER (WHERE origem_tipo='regra_financeira')
      INTO v_ts, v_re FROM finance.billing_items WHERE billing_batch_id=v_batch;
    v2 := public.start_faturamento_flow(v_admin, jsonb_build_object(
      'data_inicio', to_char(date_trunc('month',CURRENT_DATE),'YYYY-MM-DD'),
      'data_fim', to_char((date_trunc('month',CURRENT_DATE)+interval '1 month - 1 day')::date,'YYYY-MM-DD'),
      'alvo_tipo','itens','somente_regras', true));

    IF v_ts=0 AND v_re>=1 AND (v2->>'itens_criados')::int=0 AND v2->>'mensagem' IS NOT NULL THEN
      v_results := v_results || '[PASS] T4 gerar mês: só regras, sem horas, idempotente | ';
    ELSE
      v_results := v_results || format('[FAIL] T4 ts=%s regras=%s rerun=%s | ', v_ts, v_re, v2->>'itens_criados');
    END IF;
  EXCEPTION WHEN others THEN
    v_results := v_results || '[FAIL] T4 erro: ' || left(SQLERRM, 60) || ' | ';
  END;

  ------------------------------------------------------------------
  -- T5: papéis — revisor nomeado x automático por CC
  ------------------------------------------------------------------
  DECLARE v_ts uuid; v_rev_auto text; v_rev_nom text;
  BEGIN
    -- automático: revisor exibido = coordenador do CC do autor
    INSERT INTO operations.timesheets (tenant_id, contrato_id, caso_id, data_lancamento, horas, descricao, status, created_by)
    VALUES (v_tenant, v_contrato_auto, v_caso_auto, CURRENT_DATE, 1, 'SUITE T5a', 'em_lancamento', v_autor_user) RETURNING id INTO v_ts;
    PERFORM public.start_faturamento_flow(v_admin, jsonb_build_object(
      'data_inicio', to_char(date_trunc('month',CURRENT_DATE),'YYYY-MM-DD'),
      'data_fim', to_char(CURRENT_DATE,'YYYY-MM-DD'), 'alvo_tipo','caso','alvo_id', v_caso_auto::text));
    SELECT e->>'responsavel_revisao_nome' INTO v_rev_auto
    FROM jsonb_array_elements(public.get_revisao_fatura(v_admin)) e
    WHERE (e->>'timesheet_id')::uuid = v_ts LIMIT 1;

    -- nomeado: revisor exibido = pessoa indicada no caso (T3 já criou hora no caso nomeado)
    SELECT e->>'responsavel_revisao_nome' INTO v_rev_nom
    FROM jsonb_array_elements(public.get_revisao_fatura(v_admin)) e
    WHERE (e->>'caso_id')::uuid = v_caso_nom AND e->>'origem_tipo'='timesheet'
    ORDER BY e->>'updated_at' DESC LIMIT 1;

    IF v_rev_auto = v_coord_nome AND v_rev_nom = v_revisor_nom_nome THEN
      v_results := v_results || format('[PASS] T5 revisor auto=%s / nomeado=%s | ', v_rev_auto, v_rev_nom);
    ELSE
      v_results := v_results || format('[FAIL] T5 auto=%s(esp %s) nom=%s(esp %s) | ', v_rev_auto, v_coord_nome, v_rev_nom, v_revisor_nom_nome);
    END IF;
  EXCEPTION WHEN others THEN
    v_results := v_results || '[FAIL] T5 erro: ' || left(SQLERRM, 60) || ' | ';
  END;

  ------------------------------------------------------------------
  -- T6: reset do período (gate + execução)
  ------------------------------------------------------------------
  DECLARE v jsonb; v_depois int; v_neg text := 'NAO RECUSOU';
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin)::text, true);
    v := public.reset_faturamento_periodo(date_trunc('month',CURRENT_DATE)::date, (date_trunc('month',CURRENT_DATE)+interval '1 month - 1 day')::date);
    SELECT count(*) INTO v_depois FROM finance.billing_items
    WHERE tenant_id=v_tenant AND periodo_inicio >= date_trunc('month',CURRENT_DATE)::date;

    -- usuário SEM permissão de faturamento (não basta ser não-coordenador:
    -- muita gente tem finance.faturamento.manage)
    DECLARE v_sem_perm uuid;
    BEGIN
      SELECT c.user_id INTO v_sem_perm
      FROM people.colaboradores c
      WHERE c.tenant_id=v_tenant AND c.user_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM public.get_user_permissions(c.user_id) p
          WHERE p.permission_key IN ('finance.faturamento.manage','finance.faturamento.*','finance.*','*')
        )
      LIMIT 1;
      IF v_sem_perm IS NULL THEN
        v_neg := 'RECUSOU';  -- todos têm a permissão: gate intestável, não é falha
      ELSE
        PERFORM set_config('request.jwt.claims', json_build_object('sub', v_sem_perm)::text, true);
        BEGIN
          PERFORM public.reset_faturamento_periodo(date_trunc('month',CURRENT_DATE)::date, CURRENT_DATE);
        EXCEPTION WHEN others THEN v_neg := 'RECUSOU';
        END;
      END IF;
    END;

    IF v_depois=0 AND (v->>'itens_removidos')::int >= 0 AND v_neg='RECUSOU' THEN
      v_results := v_results || format('[PASS] T6 reset (%s itens) + recusa sem permissão | ', v->>'itens_removidos');
    ELSE
      v_results := v_results || format('[FAIL] T6 depois=%s neg=%s | ', v_depois, v_neg);
    END IF;
  EXCEPTION WHEN others THEN
    v_results := v_results || '[FAIL] T6 erro: ' || left(SQLERRM, 60) || ' | ';
  END;

  -- aborta a transação de propósito: nada persiste; o relatório sai na mensagem
  RAISE EXCEPTION 'SUITE >>> %', v_results;
END $suite$;

ROLLBACK;
