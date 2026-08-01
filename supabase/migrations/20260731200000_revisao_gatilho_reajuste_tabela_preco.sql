-- Passos 4, 5 e 6 do conserto da tabela de preco por cargo.
--
--  4. get_revisao_fatura: o "valor/hora vigente" mostrado na revisao passa a
--     ser resolvido pela tabela de preco usando o cargo congelado no
--     lancamento (operations.timesheets.cargo_id), e nao mais so o valor avulso.
--  5. recalcular_aprovados_apos_regra: o gatilho desistia quando o caso nao
--     tinha valor avulso (IF ... IS NULL THEN RETURN) — justamente os casos com
--     tabela. Agora resolve item a item, pelo cargo de cada lancamento.
--  6. aplicar_reajuste_casos: o reajuste corrigia valor_mensal/hora/projeto e
--     ignorava a tabela de preco, deixando casos por senioridade sem correcao
--     para sempre. Agora reajusta cada faixa da tabela e registra no log.
--
-- Onde nao ha tabela de preco, tudo cai no mesmo valor avulso de antes.

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
          'revisores_modo', cs.timesheet_config->>'revisores_modo',
          'timesheet_descricao_original', NULLIF(bi.snapshot->>'timesheet_descricao_original', ''),
          'valor_hora_atual', COALESCE(vha.valor_hora_atual, 0),
          'caso_regra_cobranca', CASE
            WHEN bi.origem_tipo = 'timesheet' THEN
              -- aba Horas só quando o caso cobra por hora; senão a regra ativa do caso
              CASE
                WHEN regra_caso.tem_hora THEN 'hora'
                ELSE COALESCE(regra_caso.primeira_ativa, NULLIF(cs.regra_cobranca, ''))
              END
            ELSE COALESCE(
              NULLIF(bi.snapshot->>'regra_cobranca', ''),
              NULLIF(cs.regra_cobranca, ''),
              regra_caso.primeira_ativa
            )
          END,
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
          'enviado_por_foto', COALESCE(ts_colab.foto_url, orig_colab.foto_url),
          'revisor_foto', COALESCE(rev_actor_colab.foto_url, rev_colab.foto_url, auto_rev.foto_url),
          'aprovador_foto', COALESCE(apr_actor_colab.foto_url, apr_colab.foto_url),
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
      SELECT
        EXISTS (
          SELECT 1 FROM jsonb_array_elements(
            CASE WHEN jsonb_typeof(cs.regras_financeiras) = 'array' THEN cs.regras_financeiras ELSE '[]'::jsonb END
          ) r
          WHERE COALESCE(NULLIF(r->>'status',''),'ativo') = 'ativo'
            AND NULLIF(r->>'regra_cobranca','') IN ('hora','hora_com_cap')
        ) OR NULLIF(cs.regra_cobranca,'') IN ('hora','hora_com_cap') AS tem_hora,
        (
          SELECT NULLIF(r->>'regra_cobranca','') FROM jsonb_array_elements(
            CASE WHEN jsonb_typeof(cs.regras_financeiras) = 'array' THEN cs.regras_financeiras ELSE '[]'::jsonb END
          ) r
          WHERE COALESCE(NULLIF(r->>'status',''),'ativo') = 'ativo'
            AND NULLIF(r->>'regra_cobranca','') IS NOT NULL
          LIMIT 1
        ) AS primeira_ativa
    ) regra_caso ON true
    LEFT JOIN LATERAL (
      SELECT t.cargo_id
      FROM operations.timesheets t
      WHERE bi.origem_tipo = 'timesheet' AND t.id = bi.origem_id
      LIMIT 1
    ) ts_cargo ON true
    LEFT JOIN LATERAL (
      -- valor/hora VIGENTE da regra hora do caso (mudou na origem -> reflete aqui)
      -- Resolve pela tabela de preço do cargo congelado no lançamento; sem
      -- tabela, cai no valor avulso (mesmo resultado de antes).
      SELECT public.resolver_valor_hora(cs.id, ts_cargo.cargo_id) AS valor_hora_atual
    ) vha ON true
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
      SELECT co.nome, co.foto_url
      FROM people.colaboradores co
      WHERE co.tenant_id = bi.tenant_id
        AND co.area_id = ia.area_id
        AND COALESCE(co.eh_coordenador, false) = true
      -- Áreas com mais de um coordenador (ex.: Societário): nunca sugerir o
      -- próprio autor do lançamento como revisor — ele fica por último e só é
      -- escolhido se for o único coordenador da área (feedback 20/07).
      ORDER BY (co.id = cs.responsavel_id) DESC, (co.user_id IS NOT DISTINCT FROM bi.created_by), co.nome
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
      AND bi.status NOT IN ('disponivel', 'cancelado', 'ignorado')
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

CREATE OR REPLACE FUNCTION contracts.recalcular_aprovados_apos_regra()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_row record;
BEGIN
  -- O valor/hora deixou de ser único por caso: com tabela de preço ele varia
  -- por cargo de quem lançou. Por isso é resolvido item a item, abaixo.

  FOR v_row IN
    SELECT bi.id, bi.valor_aprovado, bi.horas_aprovadas,
           public.resolver_valor_hora(NEW.id, ts.cargo_id) AS valor_hora_item
    FROM finance.billing_items bi
    LEFT JOIN operations.timesheets ts ON ts.id = bi.origem_id
    WHERE bi.caso_id = NEW.id
      AND bi.tenant_id = NEW.tenant_id
      AND bi.status = 'aprovado'
      AND bi.origem_tipo = 'timesheet'
      AND COALESCE(bi.snapshot->>'enviado_faturamento','') <> 'true'
      AND bi.horas_aprovadas IS NOT NULL
      AND COALESCE(public.resolver_valor_hora(NEW.id, ts.cargo_id), 0) > 0
      AND round(bi.horas_aprovadas * public.resolver_valor_hora(NEW.id, ts.cargo_id), 2)
          IS DISTINCT FROM bi.valor_aprovado
  LOOP
    UPDATE finance.billing_items bi
    SET valor_aprovado = round(v_row.horas_aprovadas * v_row.valor_hora_item, 2),
        snapshot = COALESCE(bi.snapshot,'{}'::jsonb) || jsonb_build_object(
          'valor_aprovado', round(v_row.horas_aprovadas * v_row.valor_hora_item, 2),
          'timesheet_valor_hora', v_row.valor_hora_item,
          'recalculado_por_regra_em', now()
        ),
        updated_at = now()
    WHERE bi.id = v_row.id;

    INSERT INTO finance.billing_item_audit (tenant_id, billing_item_id, action, field_name, old_value, new_value, changed_by)
    VALUES (NEW.tenant_id, v_row.id, 'recalculo_regra', 'valor_aprovado',
            to_jsonb(v_row.valor_aprovado), to_jsonb(round(v_row.horas_aprovadas * v_row.valor_hora_item, 2)), NEW.updated_by);
  END LOOP;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.aplicar_reajuste_casos(p_tenant_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'contracts'
AS $function$
DECLARE
  r RECORD;
  cfg jsonb;
  new_cfg jsonb;
  fator numeric;
  annual_rate numeric;
  oldv numeric;
  newv numeric;
  field_name text;
  months_step int;
  casos_count int := 0;
  detail jsonb := '[]'::jsonb;
  one_row jsonb;
BEGIN
  FOR r IN
    SELECT c.*
    FROM contracts.casos c
    WHERE c.possui_reajuste IS TRUE
      AND c.periodo_reajuste IS NOT NULL
      AND lower(trim(c.periodo_reajuste)) <> 'nao_tem'
      AND c.indice_reajuste IS NOT NULL
      AND lower(trim(c.indice_reajuste)) <> 'nao_tem'
      AND c.data_proximo_reajuste IS NOT NULL
      AND c.data_proximo_reajuste <= CURRENT_DATE
      AND c.status = 'ativo'
      AND (p_tenant_id IS NULL OR c.tenant_id = p_tenant_id)
  LOOP
    annual_rate := CASE lower(trim(r.indice_reajuste))
      WHEN 'ipca' THEN 0.045
      WHEN 'selic' THEN 0.1325
      WHEN 'igp-m' THEN 0.035
      WHEN 'igpm' THEN 0.035
      WHEN 'inpc' THEN 0.04
      ELSE 0.04
    END;

    fator := CASE lower(trim(r.periodo_reajuste))
      WHEN 'mensal' THEN annual_rate / 12.0
      WHEN 'bimestral' THEN annual_rate / 6.0
      WHEN 'trimestral' THEN annual_rate / 4.0
      WHEN 'semestral' THEN annual_rate / 2.0
      WHEN 'anual' THEN annual_rate
      ELSE annual_rate / 12.0
    END;

    months_step := CASE lower(trim(r.periodo_reajuste))
      WHEN 'mensal' THEN 1
      WHEN 'bimestral' THEN 2
      WHEN 'trimestral' THEN 3
      WHEN 'semestral' THEN 6
      WHEN 'anual' THEN 12
      ELSE 1
    END;

    cfg := COALESCE(r.regra_cobranca_config, '{}'::jsonb);
    new_cfg := cfg;

    FOREACH field_name IN ARRAY ARRAY['valor_mensal', 'valor_hora', 'valor_projeto']::text[]
    LOOP
      CONTINUE WHEN NOT (cfg ? field_name);
      BEGIN
        oldv := (nullif(trim(cfg ->> field_name), ''))::numeric;
      EXCEPTION WHEN OTHERS THEN
        oldv := NULL;
      END;
      CONTINUE WHEN oldv IS NULL;

      newv := round(oldv * (1 + fator), 4);
      CONTINUE WHEN newv = oldv;

      new_cfg := jsonb_set(new_cfg, ARRAY[field_name], to_jsonb(newv), true);

      INSERT INTO contracts.reajuste_log (
        tenant_id,
        caso_id,
        data_reajuste,
        indice,
        fator_aplicado,
        campo_reajustado,
        valor_anterior,
        valor_novo
      ) VALUES (
        r.tenant_id,
        r.id,
        CURRENT_DATE,
        r.indice_reajuste,
        fator,
        field_name,
        oldv,
        newv
      );
    END LOOP;

    -- A tabela de preco por cargo tambem e preco do caso: sem isto o reajuste
    -- passava por cima dela e os casos por senioridade nunca eram corrigidos.
    IF jsonb_typeof(cfg->'tabela_preco_itens') = 'array'
       AND jsonb_array_length(cfg->'tabela_preco_itens') > 0 THEN
      new_cfg := jsonb_set(new_cfg, ARRAY['tabela_preco_itens'], (
        SELECT jsonb_agg(
          CASE
            WHEN COALESCE(NULLIF(i->>'valor_hora',''),'0')::numeric > 0
              THEN i || jsonb_build_object(
                     'valor_hora',
                     round((i->>'valor_hora')::numeric * (1 + fator), 2)::text,
                     'valor_hora_excedente',
                     CASE WHEN COALESCE(NULLIF(i->>'valor_hora_excedente',''),'0')::numeric > 0
                          THEN round((i->>'valor_hora_excedente')::numeric * (1 + fator), 2)::text
                          ELSE i->>'valor_hora_excedente' END
                   )
            ELSE i
          END
        )
        FROM jsonb_array_elements(cfg->'tabela_preco_itens') i
      ), true);

      INSERT INTO contracts.reajuste_log (
        tenant_id, caso_id, data_reajuste, indice, fator_aplicado,
        campo_reajustado, valor_anterior, valor_novo
      ) VALUES (
        r.tenant_id, r.id, CURRENT_DATE, r.indice_reajuste, fator,
        'tabela_preco_itens',
        (SELECT min(NULLIF(i->>'valor_hora','')::numeric) FROM jsonb_array_elements(cfg->'tabela_preco_itens') i),
        (SELECT min(NULLIF(i->>'valor_hora','')::numeric) FROM jsonb_array_elements(new_cfg->'tabela_preco_itens') i)
      );
    END IF;

    IF new_cfg IS DISTINCT FROM cfg THEN
      UPDATE contracts.casos c
      SET
        regra_cobranca_config = new_cfg,
        data_ultimo_reajuste = r.data_proximo_reajuste,
        data_proximo_reajuste = (r.data_proximo_reajuste + (months_step || ' months')::interval)::date,
        updated_at = now()
      WHERE c.id = r.id;

      casos_count := casos_count + 1;
      one_row := jsonb_build_object(
        'caso_id', r.id,
        'indice', r.indice_reajuste,
        'periodo', r.periodo_reajuste,
        'fator', fator
      );
      detail := detail || jsonb_build_array(one_row);
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'casos_reajustados', casos_count,
    'detalhe', detail
  );
END;
$function$
;
