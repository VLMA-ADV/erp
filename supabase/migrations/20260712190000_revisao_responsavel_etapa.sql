-- Redesign da revisão (rodada 2): revisor/aprovador podem reatribuir o
-- RESPONSÁVEL PELA ETAPA no editor inline. O reatribuído passa a ver o item
-- mesmo sendo de outro centro de custo.

CREATE OR REPLACE FUNCTION public.update_revisao_fatura_item(p_user_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_tenant_id uuid;
  v_item_id uuid;
  v_batch_id uuid;
  v_item finance.billing_items%ROWTYPE;
  v_observacao text;
  v_snapshot_patch jsonb := COALESCE(p_payload->'snapshot_patch', '{}'::jsonb);
  v_review_mode text := lower(trim(COALESCE(p_payload->>'review_mode', 'default')));

  v_can_review boolean := false;
  v_can_approve boolean := false;
  v_can_manage boolean := false;

  v_horas_revisadas numeric(12,2);
  v_valor_revisado numeric(14,2);
  v_horas_aprovadas numeric(12,2);
  v_valor_aprovado numeric(14,2);

  v_timesheet_rows jsonb := COALESCE(v_snapshot_patch->'timesheet_itens_revisao', '[]'::jsonb);
  v_row jsonb;
  v_row_id_text text;
  v_row_id_uuid uuid;
  v_row_date date;
  v_row_profissional text;
  v_row_atividade text;
  v_row_horas_iniciais numeric(10,2);
  v_row_horas_revisadas numeric(10,2);
  v_row_horas_aprovadas numeric(10,2);
  v_row_valor_hora numeric(12,2);
  v_row_valor_inicial_hora numeric(12,2);
  v_row_horas_base numeric(10,2);

  v_timesheet operations.timesheets%ROWTYPE;
  v_ts_status varchar;
  v_billing_timesheet finance.billing_items%ROWTYPE;

  v_is_timesheet_mode boolean := false;
  v_processed_rows integer := 0;

  v_role text;
  v_author_name text;
BEGIN
  SELECT tenant_id INTO v_tenant_id
  FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id
    AND tu.status = 'ativo'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não associado a tenant';
  END IF;

  v_item_id := NULLIF(p_payload->>'billing_item_id', '')::uuid;
  v_batch_id := NULLIF(p_payload->>'billing_batch_id', '')::uuid;
  v_observacao := NULLIF(trim(COALESCE(p_payload->>'observacao', '')), '');

  IF v_item_id IS NULL THEN
    RAISE EXCEPTION 'billing_item_id é obrigatório';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.get_user_permissions(p_user_id) p
    WHERE p.permission_key IN ('finance.faturamento.review', 'finance.faturamento.*', 'finance.*', '*')
  ) INTO v_can_review;

  SELECT EXISTS (
    SELECT 1 FROM public.get_user_permissions(p_user_id) p
    WHERE p.permission_key IN ('finance.faturamento.approve', 'finance.faturamento.*', 'finance.*', '*')
  ) INTO v_can_approve;

  SELECT EXISTS (
    SELECT 1 FROM public.get_user_permissions(p_user_id) p
    WHERE p.permission_key IN ('finance.faturamento.manage', 'finance.faturamento.*', 'finance.*', '*')
  ) INTO v_can_manage;

  SELECT * INTO v_item
  FROM finance.billing_items bi
  WHERE bi.id = v_item_id
    AND bi.tenant_id = v_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item de faturamento não encontrado';
  END IF;

  IF v_batch_id IS NOT NULL AND v_item.billing_batch_id IS DISTINCT FROM v_batch_id THEN
    RAISE EXCEPTION 'Item não pertence ao lote informado';
  END IF;

  PERFORM public._enforce_imutable_fields(p_payload);

  -- Reatribuição do responsável pela etapa (editor inline do redesign):
  -- em revisão troca o revisor; em aprovação troca o aprovador.
  DECLARE
    v_novo_resp_colab uuid := NULLIF(p_payload->>'novo_responsavel_colaborador_id', '')::uuid;
    v_novo_resp_user uuid;
  BEGIN
    IF v_novo_resp_colab IS NOT NULL THEN
      SELECT c.user_id INTO v_novo_resp_user
      FROM people.colaboradores c
      WHERE c.id = v_novo_resp_colab AND c.tenant_id = v_tenant_id;
      IF v_novo_resp_user IS NULL THEN
        RAISE EXCEPTION 'Responsável indicado não tem usuário ativo no sistema';
      END IF;
      IF v_item.status = 'em_revisao' THEN
        UPDATE finance.billing_items SET responsavel_revisao_id = v_novo_resp_user, updated_at = now(), updated_by = p_user_id
        WHERE id = v_item.id;
      ELSIF v_item.status = 'em_aprovacao' THEN
        UPDATE finance.billing_items SET responsavel_aprovacao_id = v_novo_resp_user, updated_at = now(), updated_by = p_user_id
        WHERE id = v_item.id;
      END IF;
    END IF;
  END;

  v_role := upper(trim(COALESCE(p_payload->>'role', '')));
  IF v_role = 'USUARIO' THEN
    RAISE EXCEPTION 'role USUARIO não é permitido em update_revisao_fatura_item';
  END IF;
  IF v_role NOT IN ('REVISOR', 'APROVADOR') THEN
    RAISE EXCEPTION 'Campo obrigatório: role deve ser REVISOR ou APROVADOR';
  END IF;
  IF v_item.status = 'em_revisao' AND v_role <> 'REVISOR' THEN
    RAISE EXCEPTION 'Item em revisão exige role REVISOR';
  END IF;
  IF v_item.status = 'em_aprovacao' AND v_role <> 'APROVADOR' THEN
    RAISE EXCEPTION 'Item em aprovação exige role APROVADOR';
  END IF;

  v_is_timesheet_mode := (
    v_item.origem_tipo = 'timesheet'
    OR v_review_mode = 'timesheet'
    OR jsonb_typeof(v_snapshot_patch->'timesheet_itens_revisao') = 'array'
  );

  IF v_item.status = 'em_revisao' THEN
    IF NOT (v_can_review OR v_can_manage) THEN
      RAISE EXCEPTION 'Sem permissão para revisar item';
    END IF;

    IF v_is_timesheet_mode AND jsonb_typeof(v_timesheet_rows) = 'array' THEN
      FOR v_row IN
        SELECT value
        FROM jsonb_array_elements(v_timesheet_rows)
      LOOP
        v_row_id_text := NULLIF(trim(COALESCE(v_row->>'id', '')), '');
        v_row_id_uuid := NULL;

        IF v_row_id_text IS NOT NULL AND v_row_id_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
          v_row_id_uuid := v_row_id_text::uuid;
        END IF;

        v_row_date := COALESCE(NULLIF(v_row->>'data_lancamento', '')::date, v_item.data_referencia, now()::date);
        v_row_profissional := COALESCE(NULLIF(v_row->>'profissional', ''), '');
        v_row_atividade := COALESCE(NULLIF(v_row->>'atividade', ''), 'Timesheet ajustada na revisão');
        v_row_horas_iniciais := COALESCE(NULLIF(v_row->>'horas_iniciais', '')::numeric, 0)::numeric(10,2);
        v_row_horas_revisadas := COALESCE(NULLIF(v_row->>'horas_revisadas', '')::numeric, v_row_horas_iniciais, 0)::numeric(10,2);
        v_row_horas_aprovadas := v_row_horas_revisadas;
        v_row_valor_hora := COALESCE(NULLIF(v_row->>'valor_hora', '')::numeric, 0)::numeric(12,2);
        v_row_valor_inicial_hora := COALESCE(NULLIF(v_row->>'valor_hora_inicial', '')::numeric, v_row_valor_hora, 0)::numeric(12,2);
        v_row_horas_base := COALESCE(NULLIF(v_row_horas_iniciais, 0), NULLIF(v_row_horas_revisadas, 0), 0)::numeric(10,2);

        IF v_row_horas_base <= 0 THEN
          CONTINUE;
        END IF;

        v_ts_status := 'revisao';

        IF v_row_id_uuid IS NOT NULL THEN
          SELECT * INTO v_timesheet
          FROM operations.timesheets t
          WHERE t.id = v_row_id_uuid
            AND t.tenant_id = v_tenant_id
            AND t.contrato_id = v_item.contrato_id
            AND t.caso_id = v_item.caso_id
          FOR UPDATE;
        ELSE
          v_timesheet := NULL;
        END IF;

        IF v_timesheet.id IS NULL THEN
          INSERT INTO operations.timesheets (
            tenant_id,
            contrato_id,
            caso_id,
            data_lancamento,
            horas,
            horas_revisadas,
            horas_aprovadas,
            descricao,
            status,
            revisado_por,
            created_by,
            updated_by
          ) VALUES (
            v_tenant_id,
            v_item.contrato_id,
            v_item.caso_id,
            v_row_date,
            v_row_horas_base,
            v_row_horas_revisadas,
            v_row_horas_aprovadas,
            v_row_atividade,
            v_ts_status,
            p_user_id,
            p_user_id,
            p_user_id
          ) RETURNING * INTO v_timesheet;

          PERFORM public.create_audit_log(
            v_tenant_id,
            'timesheet',
            v_timesheet.id,
            'create',
            p_user_id,
            NULL,
            to_jsonb(v_timesheet),
            NULL,
            NULL
          );
        ELSE
          PERFORM public.create_audit_log(
            v_tenant_id,
            'timesheet',
            v_timesheet.id,
            'update',
            p_user_id,
            to_jsonb(v_timesheet),
            jsonb_build_object(
              'data_lancamento', v_timesheet.data_lancamento,
              'descricao', v_row_atividade,
              'horas', v_row_horas_base,
              'horas_revisadas', v_row_horas_revisadas,
              'status', v_ts_status
            ),
            NULL,
            NULL
          );

          UPDATE operations.timesheets t
          SET
            horas = v_row_horas_base,
            horas_revisadas = v_row_horas_revisadas,
            descricao = v_row_atividade,
            status = v_ts_status,
            revisado_por = p_user_id,
            updated_at = now(),
            updated_by = p_user_id
          WHERE t.id = v_timesheet.id
            AND t.tenant_id = v_tenant_id
          RETURNING * INTO v_timesheet;
        END IF;

        SELECT * INTO v_billing_timesheet
        FROM finance.billing_items bi
        WHERE bi.tenant_id = v_tenant_id
          AND bi.origem_tipo = 'timesheet'
          AND bi.origem_id = v_timesheet.id
          AND bi.status <> 'cancelado'
        FOR UPDATE;

        IF v_billing_timesheet.id IS NULL THEN
          INSERT INTO finance.billing_items (
            tenant_id,
            billing_batch_id,
            cliente_id,
            contrato_id,
            caso_id,
            origem_tipo,
            origem_id,
            data_referencia,
            periodo_inicio,
            periodo_fim,
            status,
            valor_informado,
            horas_informadas,
            horas_revisadas,
            valor_revisado,
            snapshot,
            created_by,
            updated_by
          ) VALUES (
            v_tenant_id,
            NULL,
            v_item.cliente_id,
            v_item.contrato_id,
            v_item.caso_id,
            'timesheet',
            v_timesheet.id,
            v_row_date,
            v_item.periodo_inicio,
            v_item.periodo_fim,
            v_item.status,
            (v_row_horas_base * v_row_valor_inicial_hora)::numeric(14,2),
            v_row_horas_base,
            v_row_horas_revisadas,
            (v_row_horas_revisadas * v_row_valor_hora)::numeric(14,2),
            jsonb_build_object(
              'origem', 'timesheet',
              'regra_nome', 'Timesheet',
              'timesheet_data_lancamento', v_row_date,
              'timesheet_horas', v_row_horas_base,
              'timesheet_descricao', v_row_atividade,
              'timesheet_profissional', v_row_profissional,
              'timesheet_valor_hora', v_row_valor_hora,
              'timesheet_valor_hora_inicial', v_row_valor_inicial_hora
            ),
            p_user_id,
            p_user_id
          ) RETURNING * INTO v_billing_timesheet;

          INSERT INTO finance.billing_item_audit (
            tenant_id,
            billing_item_id,
            action,
            field_name,
            old_value,
            new_value,
            changed_by
          ) VALUES (
            v_tenant_id,
            v_billing_timesheet.id,
            'create_item',
            'billing_item',
            NULL,
            to_jsonb(v_billing_timesheet),
            p_user_id
          );
        ELSE
          UPDATE finance.billing_items bi
          SET
            status = v_item.status,
            data_referencia = v_billing_timesheet.data_referencia,
            horas_informadas = v_billing_timesheet.horas_informadas,
            valor_informado = v_billing_timesheet.valor_informado,
            horas_revisadas = v_row_horas_revisadas,
            valor_revisado = (v_row_horas_revisadas * v_row_valor_hora)::numeric(14,2),
            snapshot = COALESCE(bi.snapshot, '{}'::jsonb)
              || jsonb_build_object(
                'origem', 'timesheet',
                'regra_nome', 'Timesheet',
                'timesheet_data_lancamento', v_billing_timesheet.data_referencia,
                'timesheet_horas', v_billing_timesheet.horas_informadas,
                'timesheet_descricao', v_row_atividade,
                'timesheet_profissional', v_row_profissional,
                'timesheet_valor_hora', v_row_valor_hora,
                'timesheet_valor_hora_inicial', v_row_valor_inicial_hora
              ),
            updated_at = now(),
            updated_by = p_user_id
          WHERE bi.id = v_billing_timesheet.id
            AND bi.tenant_id = v_tenant_id
          RETURNING * INTO v_billing_timesheet;

          INSERT INTO finance.billing_item_audit (
            tenant_id,
            billing_item_id,
            action,
            field_name,
            old_value,
            new_value,
            changed_by
          ) VALUES (
            v_tenant_id,
            v_billing_timesheet.id,
            'update_snapshot',
            'timesheet_sync',
            NULL,
            jsonb_build_object(
              'timesheet_data_lancamento', v_billing_timesheet.data_referencia,
              'timesheet_horas', v_billing_timesheet.horas_informadas,
              'timesheet_horas_revisadas', v_row_horas_revisadas,
              'timesheet_profissional', v_row_profissional,
              'timesheet_descricao', v_row_atividade,
              'timesheet_valor_hora', v_row_valor_hora
            ),
            p_user_id
          );
        END IF;

        v_processed_rows := v_processed_rows + 1;
      END LOOP;

      -- Em modo timesheet para item não-timesheet: não sobrescreve horas/valor do item da regra financeira.
      IF v_item.origem_tipo <> 'timesheet' THEN
        UPDATE finance.billing_items bi
        SET
          snapshot = COALESCE(bi.snapshot, '{}'::jsonb)
            || v_snapshot_patch
            || CASE WHEN v_observacao IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('observacao_revisao', v_observacao) END,
          updated_at = now(),
          updated_by = p_user_id
        WHERE bi.id = v_item.id;

        IF v_snapshot_patch <> '{}'::jsonb THEN
          INSERT INTO finance.billing_item_audit (tenant_id, billing_item_id, action, field_name, old_value, new_value, changed_by)
          VALUES (v_tenant_id, v_item.id, 'update_snapshot', 'snapshot_patch', v_item.snapshot, COALESCE(v_item.snapshot, '{}'::jsonb) || v_snapshot_patch, p_user_id);
        END IF;

        RETURN jsonb_build_object(
          'billing_item_id', v_item.id,
          'status', v_item.status,
          'mode', 'timesheet',
          'timesheets_processed', v_processed_rows
        );
      END IF;
    END IF;

    v_horas_revisadas := COALESCE(NULLIF(p_payload->>'horas_revisadas', '')::numeric, v_item.horas_revisadas, v_item.horas_informadas, 0)::numeric(12,2);
    v_valor_revisado := COALESCE(NULLIF(p_payload->>'valor_revisado', '')::numeric, v_item.valor_revisado, v_item.valor_informado, 0)::numeric(14,2);

    UPDATE finance.billing_items bi
    SET
      horas_revisadas = v_horas_revisadas,
      valor_revisado = v_valor_revisado,
      snapshot = COALESCE(bi.snapshot, '{}'::jsonb)
        || v_snapshot_patch
        || jsonb_build_object('horas_revisadas', v_horas_revisadas, 'valor_revisado', v_valor_revisado)
        || CASE WHEN v_observacao IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('observacao_revisao', v_observacao) END,
      updated_at = now(),
      updated_by = p_user_id
    WHERE bi.id = v_item.id;

    SELECT c.nome INTO v_author_name
    FROM people.colaboradores c
    WHERE c.user_id = p_user_id AND c.tenant_id = v_tenant_id
    LIMIT 1;

    INSERT INTO finance.revisao_fatura_itens_historico (
      billing_item_id, role, author_id, author_name, horas, valor, texto, tenant_id, created_at
    ) VALUES (
      v_item.id,
      v_role,
      p_user_id,
      COALESCE(v_author_name, 'Usuário'),
      v_horas_revisadas,
      v_valor_revisado::numeric(12,2),
      v_observacao,
      v_tenant_id,
      now()
    );

    IF v_snapshot_patch <> '{}'::jsonb THEN
      INSERT INTO finance.billing_item_audit (tenant_id, billing_item_id, action, field_name, old_value, new_value, changed_by)
      VALUES (v_tenant_id, v_item.id, 'update_snapshot', 'snapshot_patch', v_item.snapshot, COALESCE(v_item.snapshot, '{}'::jsonb) || v_snapshot_patch, p_user_id);
    END IF;

    RETURN jsonb_build_object('billing_item_id', v_item.id, 'status', v_item.status, 'horas_revisadas', v_horas_revisadas, 'valor_revisado', v_valor_revisado);
  ELSIF v_item.status = 'em_aprovacao' THEN
    IF NOT (v_can_approve OR v_can_manage) THEN
      RAISE EXCEPTION 'Sem permissão para aprovar item';
    END IF;

    v_horas_aprovadas := COALESCE(NULLIF(p_payload->>'horas_aprovadas', '')::numeric, v_item.horas_aprovadas, v_item.horas_revisadas, v_item.horas_informadas, 0)::numeric(12,2);
    v_valor_aprovado := COALESCE(NULLIF(p_payload->>'valor_aprovado', '')::numeric, v_item.valor_aprovado, v_item.valor_revisado, v_item.valor_informado, 0)::numeric(14,2);

    UPDATE finance.billing_items bi
    SET
      horas_aprovadas = v_horas_aprovadas,
      valor_aprovado = v_valor_aprovado,
      snapshot = COALESCE(bi.snapshot, '{}'::jsonb)
        || v_snapshot_patch
        || jsonb_build_object('horas_aprovadas', v_horas_aprovadas, 'valor_aprovado', v_valor_aprovado)
        || CASE WHEN v_observacao IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('observacao_aprovacao', v_observacao) END,
      updated_at = now(),
      updated_by = p_user_id
    WHERE bi.id = v_item.id;

    SELECT c.nome INTO v_author_name
    FROM people.colaboradores c
    WHERE c.user_id = p_user_id AND c.tenant_id = v_tenant_id
    LIMIT 1;

    INSERT INTO finance.revisao_fatura_itens_historico (
      billing_item_id, role, author_id, author_name, horas, valor, texto, tenant_id, created_at
    ) VALUES (
      v_item.id,
      v_role,
      p_user_id,
      COALESCE(v_author_name, 'Usuário'),
      v_horas_aprovadas,
      v_valor_aprovado::numeric(12,2),
      v_observacao,
      v_tenant_id,
      now()
    );

    IF v_snapshot_patch <> '{}'::jsonb THEN
      INSERT INTO finance.billing_item_audit (tenant_id, billing_item_id, action, field_name, old_value, new_value, changed_by)
      VALUES (v_tenant_id, v_item.id, 'update_snapshot', 'snapshot_patch', v_item.snapshot, COALESCE(v_item.snapshot, '{}'::jsonb) || v_snapshot_patch, p_user_id);
    END IF;

    RETURN jsonb_build_object('billing_item_id', v_item.id, 'status', v_item.status, 'horas_aprovadas', v_horas_aprovadas, 'valor_aprovado', v_valor_aprovado);
  ELSE
    RAISE EXCEPTION 'Item não está em etapa editável (%).', v_item.status;
  END IF;
END;
$function$
;


CREATE OR REPLACE FUNCTION public.get_revisao_fatura(p_user_id uuid, p_status character varying DEFAULT NULL::character varying, p_lote text DEFAULT NULL::text, p_cliente text DEFAULT NULL::text, p_contrato text DEFAULT NULL::text, p_caso text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_tenant_id uuid;
  v_can_read boolean := false;
  v_can_view_all boolean := false;
  v_viewer_area_id uuid;
  v_viewer_area_nome text;
BEGIN
  SELECT tenant_id INTO v_tenant_id
  FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id
    AND tu.status = 'ativo'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não associado a tenant';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.get_user_permissions(p_user_id) p
    WHERE p.permission_key IN (
      'finance.faturamento.read',
      'finance.faturamento.review',
      'finance.faturamento.approve',
      'finance.faturamento.manage',
      'finance.faturamento.*',
      'finance.*',
      '*'
    )
  ) INTO v_can_read;

  IF NOT v_can_read THEN
    RAISE EXCEPTION 'Sem permissão para visualizar revisão de fatura';
  END IF;

  SELECT col.area_id, a.nome
  INTO v_viewer_area_id, v_viewer_area_nome
  FROM people.colaboradores col
  LEFT JOIN people.areas a ON a.id = col.area_id AND a.tenant_id = v_tenant_id
  WHERE col.user_id = p_user_id AND col.tenant_id = v_tenant_id
  LIMIT 1;

  -- Vê tudo: diretores (centro de custo 'VLMA'), financeiro, sem área, ou super-admin ('*').
  -- Obs.: NÃO usar finance.faturamento.* aqui — sócios de área (ex.: Leo) também têm
  -- essas permissões; a distinção é o centro de custo. gestor de área -> escopado.
  v_can_view_all :=
    EXISTS (SELECT 1 FROM public.get_user_permissions(p_user_id) p WHERE p.permission_key = '*')
    OR v_viewer_area_id IS NULL
    OR v_viewer_area_nome IN ('VLMA', 'Financeiro');

  RETURN (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'billing_item_id', bi.id,
          'item_numero', bi.numero,
          'billing_batch_id', bi.billing_batch_id,
          'batch_numero', b.numero,
          'status', bi.status,
          'origem_tipo', bi.origem_tipo,
          'data_referencia', bi.data_referencia,
          'cliente_id', cli.id,
          'cliente_nome', cli.nome,
          'contrato_id', c.id,
          'contrato_numero', c.numero,
          'contrato_nome', c.nome_contrato,
          'caso_id', cs.id,
          'caso_numero', cs.numero,
          'caso_nome', cs.nome,
          'regra_nome', COALESCE(
            NULLIF(bi.snapshot->>'regra_nome', ''),
            NULLIF(bi.snapshot->>'descricao', ''),
            CASE WHEN bi.origem_tipo = 'timesheet' THEN 'Timesheet' ELSE 'Regra financeira' END
          ),
          -- regra_cobranca do CASO (não do snapshot): permite ao front agrupar
          -- horas de casos 'projeto' na aba Projeto em vez de Horas.
          'caso_regra_cobranca', COALESCE(
            NULLIF(bi.snapshot->>'regra_cobranca', ''),
            NULLIF(cs.regra_cobranca, ''),
            CASE
              WHEN jsonb_typeof(cs.regras_financeiras) = 'array' AND jsonb_array_length(cs.regras_financeiras) > 0
                THEN NULLIF(cs.regras_financeiras->0->>'regra_cobranca', '')
            END
          ),
          'horas_informadas', CASE WHEN bi.origem_tipo = 'timesheet' THEN bi.horas_informadas ELSE 0::numeric END,
          'horas_revisadas', CASE WHEN bi.origem_tipo = 'timesheet' THEN bi.horas_revisadas ELSE 0::numeric END,
          'horas_aprovadas', CASE WHEN bi.origem_tipo = 'timesheet' THEN bi.horas_aprovadas ELSE 0::numeric END,
          'valor_informado', bi.valor_informado,
          'valor_revisado', bi.valor_revisado,
          'valor_aprovado', bi.valor_aprovado,
          'data_revisao', bi.data_revisao,
          'data_aprovacao', bi.data_aprovacao,
          'responsavel_revisao_id', bi.responsavel_revisao_id,
          'responsavel_aprovacao_id', bi.responsavel_aprovacao_id,
          'responsavel_revisao_nome', COALESCE(rev_actor_colab.nome, rev_colab.nome, auto_rev.nome),
          'responsavel_aprovacao_nome', COALESCE(apr_actor_colab.nome, apr_colab.nome),
          'responsavel_fluxo_nome', CASE
            WHEN bi.status = 'em_revisao' THEN COALESCE(rev_actor_colab.nome, rev_colab.nome, auto_rev.nome)
            WHEN bi.status = 'em_aprovacao' THEN COALESCE(apr_actor_colab.nome, apr_colab.nome)
            ELSE NULL
          END,
          'enviado_por_id', COALESCE(t.created_by, bi.created_by),
          'enviado_por_nome', COALESCE(
            NULLIF(bi.snapshot->>'timesheet_profissional', ''),
            ts_colab.nome,
            orig_colab.nome
          ),
          'timesheet_id', CASE WHEN bi.origem_tipo = 'timesheet' THEN t.id ELSE NULL END,
          'timesheet_data_lancamento', COALESCE(
            NULLIF(bi.snapshot->>'timesheet_data_lancamento', ''),
            CASE WHEN t.data_lancamento IS NOT NULL THEN t.data_lancamento::text ELSE NULL END
          ),
          'timesheet_horas', CASE
            WHEN bi.origem_tipo = 'timesheet' THEN COALESCE(
              NULLIF(bi.snapshot->>'timesheet_horas', '')::numeric,
              t.horas,
              bi.horas_informadas,
              0
            )
            ELSE 0::numeric
          END,
          'timesheet_descricao', COALESCE(
            NULLIF(bi.snapshot->>'timesheet_descricao', ''),
            t.descricao,
            ''
          ),
          'timesheet_profissional', COALESCE(
            NULLIF(bi.snapshot->>'timesheet_profissional', ''),
            ts_colab.nome,
            ''
          ),
          'timesheet_valor_hora', COALESCE(
            NULLIF(bi.snapshot->>'timesheet_valor_hora', '')::numeric,
            NULLIF(bi.snapshot->>'valor_hora', '')::numeric,
            CASE
              WHEN bi.origem_tipo = 'timesheet' AND COALESCE(t.horas, bi.horas_informadas, 0) > 0
                THEN COALESCE(bi.valor_informado, 0) / COALESCE(t.horas, bi.horas_informadas)
              ELSE 0
            END
          ),
          'snapshot', bi.snapshot,
          'updated_at', bi.updated_at,
          'historico', COALESCE(rfih.hist, '[]'::jsonb)
        )
        ORDER BY cli.nome, c.numero NULLS LAST, cs.numero NULLS LAST, bi.numero
      ),
      '[]'::jsonb
    )
    FROM finance.billing_items bi
    LEFT JOIN finance.billing_batches b
      ON b.id = bi.billing_batch_id
     AND b.tenant_id = bi.tenant_id
    JOIN crm.clientes cli
      ON cli.id = bi.cliente_id
     AND cli.tenant_id = bi.tenant_id
    JOIN contracts.contratos c
      ON c.id = bi.contrato_id
     AND c.tenant_id = bi.tenant_id
    JOIN contracts.casos cs
      ON cs.id = bi.caso_id
     AND cs.tenant_id = bi.tenant_id
    LEFT JOIN LATERAL (
      SELECT NULLIF(r->>'colaborador_id', '')::uuid AS colaborador_id
      FROM jsonb_array_elements(COALESCE(cs.timesheet_config->'revisores', '[]'::jsonb)) r
      ORDER BY COALESCE(NULLIF(r->>'ordem', '')::int, 999999)
      LIMIT 1
    ) rev_cfg ON true
    LEFT JOIN LATERAL (
      SELECT NULLIF(a->>'colaborador_id', '')::uuid AS colaborador_id
      FROM jsonb_array_elements(COALESCE(cs.timesheet_config->'aprovadores', '[]'::jsonb)) a
      ORDER BY COALESCE(NULLIF(a->>'ordem', '')::int, 999999)
      LIMIT 1
    ) apr_cfg ON true
    LEFT JOIN people.colaboradores rev_colab
      ON rev_colab.id = rev_cfg.colaborador_id
     AND rev_colab.tenant_id = bi.tenant_id
    LEFT JOIN people.colaboradores apr_colab
      ON apr_colab.id = apr_cfg.colaborador_id
     AND apr_colab.tenant_id = bi.tenant_id
    LEFT JOIN people.colaboradores rev_actor_colab
      ON rev_actor_colab.user_id = bi.responsavel_revisao_id
     AND rev_actor_colab.tenant_id = bi.tenant_id
    LEFT JOIN people.colaboradores apr_actor_colab
      ON apr_actor_colab.user_id = bi.responsavel_aprovacao_id
     AND apr_actor_colab.tenant_id = bi.tenant_id
    LEFT JOIN operations.timesheets t
      ON bi.origem_tipo = 'timesheet'
     AND t.id = bi.origem_id
     AND t.tenant_id = bi.tenant_id
    LEFT JOIN people.colaboradores ts_colab
      ON ts_colab.user_id = t.created_by
     AND ts_colab.tenant_id = bi.tenant_id
    -- Área do item: p/ timesheet = área do autor; senão = 1º centro de custo do rateio do caso.
    LEFT JOIN LATERAL (
      SELECT COALESCE(
        ts_colab.area_id,
        (SELECT NULLIF(rr->>'centro_custo_id', '')::uuid
           FROM jsonb_array_elements(CASE WHEN jsonb_typeof(cs.centro_custo_rateio) = 'array' THEN cs.centro_custo_rateio ELSE '[]'::jsonb END) rr
           WHERE NULLIF(rr->>'centro_custo_id', '') IS NOT NULL
           LIMIT 1)
      ) AS area_id
    ) ia ON true
    -- Revisor automático por centro de custo = coordenador da área do item.
    LEFT JOIN LATERAL (
      SELECT co.nome
      FROM people.colaboradores co
      WHERE co.tenant_id = bi.tenant_id
        AND co.area_id = ia.area_id
        AND COALESCE(co.eh_coordenador, false) = true
      ORDER BY co.nome
      LIMIT 1
    ) auto_rev ON (cs.timesheet_config->>'revisores_modo') = 'auto_centro_custo'
    LEFT JOIN people.colaboradores orig_colab
      ON orig_colab.user_id = bi.created_by
     AND orig_colab.tenant_id = bi.tenant_id
    LEFT JOIN LATERAL (
      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'id', h.id,
            'role', h.role,
            'author_id', h.author_id,
            'author_name', COALESCE(c_hist.nome, h.author_name),
            'horas', h.horas,
            'valor', h.valor,
            'texto', h.texto,
            'created_at', h.created_at
          ) ORDER BY h.created_at ASC
        ),
        '[]'::jsonb
      ) AS hist
      FROM finance.revisao_fatura_itens_historico h
      LEFT JOIN people.colaboradores c_hist
        ON c_hist.user_id = h.author_id AND c_hist.tenant_id = h.tenant_id
      WHERE h.billing_item_id = bi.id AND h.tenant_id = bi.tenant_id
    ) rfih ON true
    WHERE bi.tenant_id = v_tenant_id
      AND bi.status NOT IN ('disponivel', 'cancelado')
      AND (
        v_can_view_all
        -- responsável reatribuído da etapa vê o item mesmo de outro CC
        OR bi.responsavel_revisao_id = p_user_id
        OR bi.responsavel_aprovacao_id = p_user_id
        -- item de timesheet: área do autor = área do gestor
        OR (bi.origem_tipo = 'timesheet' AND ts_colab.area_id = v_viewer_area_id)
        -- qualquer item: centro de custo (rateio) do caso inclui a área do gestor
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements(CASE WHEN jsonb_typeof(cs.centro_custo_rateio) = 'array' THEN cs.centro_custo_rateio ELSE '[]'::jsonb END) rr
          WHERE NULLIF(rr->>'centro_custo_id', '')::uuid = v_viewer_area_id
        )
      )
      AND (
        p_status IS NULL
        OR trim(p_status) = ''
        OR bi.status = trim(p_status)
      )
      AND (
        p_cliente IS NULL
        OR trim(p_cliente) = ''
        OR cli.nome ILIKE '%' || trim(p_cliente) || '%'
      )
      AND (
        p_contrato IS NULL
        OR trim(p_contrato) = ''
        OR c.nome_contrato ILIKE '%' || trim(p_contrato) || '%'
        OR c.numero::text ILIKE '%' || trim(p_contrato) || '%'
      )
      AND (
        p_caso IS NULL
        OR trim(p_caso) = ''
        OR cs.nome ILIKE '%' || trim(p_caso) || '%'
        OR cs.numero::text ILIKE '%' || trim(p_caso) || '%'
      )
  );
END;
$function$
;

NOTIFY pgrst, 'reload schema';
