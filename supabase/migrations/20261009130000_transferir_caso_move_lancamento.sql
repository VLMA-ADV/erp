-- Transferir caso sem duplicar lançamento (caso 1935, Caminhos do Paraná, 09/10).
-- 1) update_revisao_fatura_item: acha a linha da revisão pelo id do lançamento,
--    sem exigir que ele esteja no caso/contrato do item (item transferido gerava
--    lançamento + item gêmeos).
-- 2) transferir_billing_item_caso: transferência atômica usada pela edge
--    update-faturamento-item (item + lançamento + snapshot + auditoria).

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
          -- Só id + tenant. Antes exigia também o caso/contrato do ITEM: num
          -- item transferido de caso (o lançamento ficava no caso antigo) a
          -- linha não era achada e caía no INSERT abaixo, criando um
          -- lançamento e um item NOVOS iguais ao original — o mesmo trabalho
          -- cobrado duas vezes (caso 1935, Caminhos do Paraná, 09/10: itens
          -- 7291 e 7617).
          WHERE t.id = v_row_id_uuid
            AND t.tenant_id = v_tenant_id
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
                -- preserva o ORIGINAL na 1ª edição (o Envio nunca muda na tela)
                'timesheet_descricao_original', COALESCE(bi.snapshot->>'timesheet_descricao_original', bi.snapshot->>'timesheet_descricao'),
                'timesheet_data_lancamento_original', COALESCE(bi.snapshot->>'timesheet_data_lancamento_original', bi.snapshot->>'timesheet_data_lancamento'),
                'timesheet_profissional_original', COALESCE(bi.snapshot->>'timesheet_profissional_original', bi.snapshot->>'timesheet_profissional'),
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

-- Transferir caso (Revisão de fatura). Antes a edge update-faturamento-item só
-- trocava caso/contrato/cliente do billing_item: o lançamento (timesheet)
-- ficava no caso antigo, o snapshot continuava apontando o caso antigo, nada
-- ia para a auditoria e um item já faturado ou agrupado podia ser movido.
-- Caso 1935 (Caminhos do Paraná, 09/10): item 7291 transferido com o
-- lançamento ainda no 363 -> a revisão seguinte não achava o lançamento no
-- caso do item e criava um gêmeo (7617), cobrado duas vezes no relatório.
-- Agora, numa transação só: move o item, o lançamento de origem e o snapshot,
-- grava auditoria e recusa o que não pode mudar de caso.
CREATE OR REPLACE FUNCTION public.transferir_billing_item_caso(p_user_id uuid, p_item_id uuid, p_caso_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'finance', 'contracts', 'crm', 'operations', 'core'
AS $function$
DECLARE
  v_tenant uuid;
  v_item finance.billing_items%ROWTYPE;
  v_caso record;
  v_nota record;
  v_snapshot jsonb;
  v_ts_movido boolean := false;
BEGIN
  p_user_id := COALESCE(auth.uid(), p_user_id);

  SELECT tu.tenant_id INTO v_tenant
    FROM core.tenant_users tu
   WHERE tu.user_id = p_user_id AND tu.status = 'ativo' LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.get_user_permissions(p_user_id) p
     WHERE p.permission_key IN ('finance.faturamento.review', 'finance.faturamento.approve',
                                'finance.faturamento.manage', 'finance.faturamento.*', 'finance.*', '*')
  ) THEN
    RAISE EXCEPTION 'Você não tem permissão para alterar item de faturamento';
  END IF;

  SELECT * INTO v_item
    FROM finance.billing_items bi
   WHERE bi.id = p_item_id AND bi.tenant_id = v_tenant
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Item de faturamento não encontrado'; END IF;

  SELECT cs.id, cs.numero, cs.nome, cs.contrato_id,
         ct.numero AS contrato_numero, ct.nome_contrato, ct.cliente_id,
         cl.nome AS cliente_nome
    INTO v_caso
    FROM contracts.casos cs
    JOIN contracts.contratos ct ON ct.id = cs.contrato_id
    LEFT JOIN crm.clientes cl ON cl.id = ct.cliente_id
   WHERE cs.id = p_caso_id AND cs.tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Caso de destino não encontrado'; END IF;
  IF v_caso.cliente_id IS NULL THEN
    RAISE EXCEPTION 'Não foi possível determinar o cliente do caso de destino';
  END IF;

  IF v_item.caso_id IS NOT DISTINCT FROM p_caso_id THEN
    RETURN jsonb_build_object('billing_item_id', v_item.id, 'caso_id', p_caso_id,
                              'contrato_id', v_caso.contrato_id, 'sem_mudanca', true);
  END IF;

  IF v_item.status IN ('faturado', 'cancelado') THEN
    RAISE EXCEPTION 'Item % não pode mudar de caso (%).', v_item.numero, v_item.status;
  END IF;

  IF v_item.grupo_id IS NOT NULL THEN
    RAISE EXCEPTION 'Item % está agrupado. Desagrupe antes de transferir de caso.', v_item.numero;
  END IF;

  -- Mesma trava do excluir_kit: item numa NFS-e autorizada/em processamento.
  SELECT bn.numero, bn.focus_status INTO v_nota
    FROM finance.billing_notes bn
   WHERE bn.tenant_id = v_tenant
     AND bn.tipo_documento = 'nota_fiscal_servico'
     AND bn.status = 'gerado'
     AND bn.focus_status IN ('autorizado', 'processando')
     AND bn.metadata->'item_ids' ? v_item.id::text
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Item % está na NFS-e % (%). Cancele a nota antes de transferir.',
      v_item.numero, v_nota.numero, v_nota.focus_status;
  END IF;

  -- Snapshot: as chaves de caso/contrato/cliente que existirem passam a
  -- apontar o destino, e cada linha de timesheet_itens_revisao também.
  v_snapshot := COALESCE(v_item.snapshot, '{}'::jsonb);
  IF v_snapshot ? 'caso_id'         THEN v_snapshot := v_snapshot || jsonb_build_object('caso_id', v_caso.id); END IF;
  IF v_snapshot ? 'caso_numero'     THEN v_snapshot := v_snapshot || jsonb_build_object('caso_numero', v_caso.numero); END IF;
  IF v_snapshot ? 'caso_nome'       THEN v_snapshot := v_snapshot || jsonb_build_object('caso_nome', v_caso.nome); END IF;
  IF v_snapshot ? 'contrato_id'     THEN v_snapshot := v_snapshot || jsonb_build_object('contrato_id', v_caso.contrato_id); END IF;
  IF v_snapshot ? 'contrato_numero' THEN v_snapshot := v_snapshot || jsonb_build_object('contrato_numero', v_caso.contrato_numero); END IF;
  IF v_snapshot ? 'contrato_nome'   THEN v_snapshot := v_snapshot || jsonb_build_object('contrato_nome', v_caso.nome_contrato); END IF;
  IF v_snapshot ? 'cliente_id'      THEN v_snapshot := v_snapshot || jsonb_build_object('cliente_id', v_caso.cliente_id); END IF;
  IF v_snapshot ? 'cliente_nome'    THEN v_snapshot := v_snapshot || jsonb_build_object('cliente_nome', v_caso.cliente_nome); END IF;
  IF jsonb_typeof(v_snapshot->'timesheet_itens_revisao') = 'array' THEN
    v_snapshot := jsonb_set(v_snapshot, '{timesheet_itens_revisao}', COALESCE((
      SELECT jsonb_agg(CASE WHEN jsonb_typeof(r) = 'object'
                            THEN r || jsonb_build_object('caso_id', v_caso.id, 'contrato_id', v_caso.contrato_id)
                            ELSE r END ORDER BY o)
        FROM jsonb_array_elements(v_snapshot->'timesheet_itens_revisao') WITH ORDINALITY AS x(r, o)
    ), '[]'::jsonb));
  END IF;

  UPDATE finance.billing_items bi
     SET caso_id = v_caso.id,
         contrato_id = v_caso.contrato_id,
         cliente_id = v_caso.cliente_id,
         snapshot = v_snapshot,
         updated_at = now(),
         updated_by = p_user_id
   WHERE bi.id = v_item.id;

  -- O lançamento acompanha o item: é ele que a revisão procura e que a tela de
  -- Timesheet mostra. Só move se nenhum OUTRO item vivo usa o mesmo lançamento.
  IF v_item.origem_tipo = 'timesheet' AND v_item.origem_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM finance.billing_items o
        WHERE o.tenant_id = v_tenant AND o.origem_tipo = 'timesheet'
          AND o.origem_id = v_item.origem_id AND o.id <> v_item.id
          AND o.status NOT IN ('cancelado', 'ignorado'))
  THEN
    UPDATE operations.timesheets t
       SET caso_id = v_caso.id,
           contrato_id = v_caso.contrato_id,
           updated_at = now(),
           updated_by = p_user_id
     WHERE t.id = v_item.origem_id AND t.tenant_id = v_tenant
       AND (t.caso_id IS DISTINCT FROM v_caso.id OR t.contrato_id IS DISTINCT FROM v_caso.contrato_id);
    v_ts_movido := FOUND;
  END IF;

  INSERT INTO finance.billing_item_audit (tenant_id, billing_item_id, action, field_name, old_value, new_value, changed_by)
  VALUES (v_tenant, v_item.id, 'transfer_case', 'caso_id',
          jsonb_build_object('caso_id', v_item.caso_id, 'contrato_id', v_item.contrato_id, 'cliente_id', v_item.cliente_id),
          jsonb_build_object('caso_id', v_caso.id, 'contrato_id', v_caso.contrato_id, 'cliente_id', v_caso.cliente_id,
                             'timesheet_movido', v_ts_movido),
          p_user_id);

  RETURN jsonb_build_object('billing_item_id', v_item.id, 'caso_id', v_caso.id,
                            'contrato_id', v_caso.contrato_id, 'timesheet_movido', v_ts_movido);
END;
$function$;

REVOKE ALL ON FUNCTION public.transferir_billing_item_caso(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transferir_billing_item_caso(uuid, uuid, uuid) TO authenticated, service_role;
