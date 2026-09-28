-- Rodada 28/09/2026 (Filipe) — faturamento de outubro.
--
-- 1. start_faturamento_flow / start_faturamento_despesas_fallback: alvo_tipo='itens'
--    passa a filtrar de verdade por alvo_ids (origem_id da fila) e/ou alvo_chaves
--    ('fila:<origem_tipo>:<origem_id>'). Antes 'itens' liberava o tenant inteiro,
--    e por isso "Liberar selecionados (N)" liberava o caso todo. Sem seleção,
--    comportamento idêntico ao anterior.
-- 2. excluir_kit: devolver o kit da Composição leva os itens para em_aprovacao
--    (não em_revisao), preservando a revisão. Rastro no histórico do item.
-- 3. finance.boletos: status 'cancelado' entra no CHECK (o código já filtra por ele).
--
-- Funções copiadas da versão em produção em 28/09 (pg_get_functiondef) + os
-- trechos marcados "28/09".

-- ---------------------------------------------------------------------------
-- 1. Liberar só os itens selecionados
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.start_faturamento_flow(p_user_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_tenant_id uuid;
  v_data_inicio date;
  v_data_fim date;
  v_alvo_tipo varchar;
  v_alvo_id uuid;
  v_alvo_ids uuid[] := ARRAY[]::uuid[];
  v_search text;
  v_somente_regras boolean := false;
  v_batch_id uuid;
  v_batch_numero bigint;
  v_items_count int := 0;
  v_can_write boolean := false;
  -- 28/09: seleção de itens da fila (ver bloco alvo_chaves abaixo)
  v_sel_ts uuid[] := ARRAY[]::uuid[];
  v_sel_desp uuid[] := ARRAY[]::uuid[];
  v_sel_regra uuid[] := ARRAY[]::uuid[];
  v_filtra_itens boolean := false;
  v_msg_preco text;
  v_desp jsonb;
  v_desp_count int := 0;
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
      'finance.faturamento.write',
      'finance.faturamento.manage',
      'finance.faturamento.*',
      'finance.*',
      '*'
    )
  ) INTO v_can_write;
  IF NOT v_can_write THEN
    RAISE EXCEPTION 'Sem permissão para iniciar fluxo de faturamento';
  END IF;
  v_data_inicio := NULLIF(p_payload->>'data_inicio', '')::date;
  v_data_fim := NULLIF(p_payload->>'data_fim', '')::date;
  v_alvo_tipo := COALESCE(NULLIF(p_payload->>'alvo_tipo', ''), 'itens');
  v_alvo_id := NULLIF(p_payload->>'alvo_id', '')::uuid;
  v_search := NULLIF(trim(COALESCE(p_payload->>'search', '')), '');
  v_somente_regras := COALESCE((p_payload->>'somente_regras')::boolean, false);
  IF jsonb_typeof(p_payload->'alvo_ids') = 'array' THEN
    SELECT COALESCE(array_agg(value::uuid), ARRAY[]::uuid[]) INTO v_alvo_ids
    FROM jsonb_array_elements_text(p_payload->'alvo_ids') AS t(value)
    WHERE value IS NOT NULL
      AND value <> ''
      AND value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
  END IF;
  IF v_alvo_id IS NOT NULL THEN
    v_alvo_ids := array_append(v_alvo_ids, v_alvo_id);
  END IF;
  SELECT COALESCE(array_agg(DISTINCT entry), ARRAY[]::uuid[]) INTO v_alvo_ids
  FROM unnest(v_alvo_ids) AS entry;

  -- 28/09 (Filipe): "selecionar um a um e selecionar todos para liberar em
  -- massa". Com alvo_tipo='itens' a seleção chega por alvo_ids (origem_id da
  -- fila: timesheet.id, despesa.id ou o uuid da regra) e/ou alvo_chaves (os
  -- ids virtuais 'fila:<origem_tipo>:<origem_id>' que get_fila_por_competencia
  -- devolve). alvo_ids não diz o tipo, então vale para os três; alvo_chaves
  -- entra só no tipo que declara. Sem nenhum dos dois, 'itens' segue liberando
  -- o tenant inteiro (comportamento antigo).
  IF v_alvo_tipo = 'itens' THEN
    v_sel_ts := v_alvo_ids;
    v_sel_desp := v_alvo_ids;
    v_sel_regra := v_alvo_ids;
    IF jsonb_typeof(p_payload->'alvo_chaves') = 'array' THEN
      SELECT
        v_sel_ts || COALESCE(array_agg(m.origem) FILTER (WHERE m.tipo = 'timesheet'), ARRAY[]::uuid[]),
        v_sel_desp || COALESCE(array_agg(m.origem) FILTER (WHERE m.tipo = 'despesa'), ARRAY[]::uuid[]),
        v_sel_regra || COALESCE(array_agg(m.origem) FILTER (WHERE m.tipo NOT IN ('timesheet', 'despesa')), ARRAY[]::uuid[])
      INTO v_sel_ts, v_sel_desp, v_sel_regra
      FROM (
        SELECT split_part(value, ':', 2) AS tipo, split_part(value, ':', 3)::uuid AS origem
        FROM jsonb_array_elements_text(p_payload->'alvo_chaves') AS t(value)
        WHERE value ~* '^fila:[a-z_]+:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      ) m;
    END IF;
    v_filtra_itens := COALESCE(array_length(v_sel_ts, 1), 0)
                    + COALESCE(array_length(v_sel_desp, 1), 0)
                    + COALESCE(array_length(v_sel_regra, 1), 0) > 0;
  END IF;

  -- Passo 7: barra hora sem preço antes de criar qualquer item.
  -- Com 'itens' os alvo_ids não são casos: a trava roda logo abaixo, só sobre
  -- as horas marcadas (uma hora sem preço de outro cargo não deve travar a
  -- que a pessoa escolheu).
  IF NOT v_somente_regras AND v_alvo_tipo <> 'itens' AND array_length(v_alvo_ids, 1) > 0 THEN
    PERFORM public.validar_precos_antes_de_liberar(v_tenant_id, v_alvo_ids);
  END IF;
  IF NOT v_somente_regras AND v_filtra_itens AND COALESCE(array_length(v_sel_ts, 1), 0) > 0 THEN
    -- Mesma regra de validar_precos_antes_de_liberar, restrita à seleção.
    SELECT string_agg(DISTINCT format('caso %s (%s)', cs.numero, COALESCE(cg.nome, 'sem cargo')), '; ')
      INTO v_msg_preco
    FROM operations.timesheets t
    JOIN contracts.casos cs ON cs.id = t.caso_id
    LEFT JOIN people.cargos cg ON cg.id = t.cargo_id
    WHERE t.tenant_id = v_tenant_id
      AND t.id = ANY(v_sel_ts)
      AND t.status = 'em_lancamento'
      AND COALESCE(t.horas, 0) > 0
      AND (
        COALESCE(NULLIF(cs.regra_cobranca, ''), '') IN ('hora', 'hora_com_cap')
        OR EXISTS (
          SELECT 1 FROM jsonb_array_elements(
            CASE WHEN jsonb_typeof(cs.regras_financeiras) = 'array'
                 THEN cs.regras_financeiras ELSE '[]'::jsonb END) r
          WHERE COALESCE(NULLIF(r->>'status', ''), 'ativo') = 'ativo'
            AND NULLIF(r->>'regra_cobranca', '') IN ('hora', 'hora_com_cap')
        )
      )
      AND COALESCE(public.resolver_valor_hora(cs.id, t.cargo_id), 0) <= 0;
    IF v_msg_preco IS NOT NULL THEN
      RAISE EXCEPTION 'Não dá para liberar: sem valor/hora definido para %. Cadastre o valor na regra de cobrança do caso (ou o cargo na tabela de preço) antes de liberar.', v_msg_preco;
    END IF;
  END IF;
  IF v_data_inicio IS NULL OR v_data_fim IS NULL THEN
    RAISE EXCEPTION 'Informe data inicial e final';
  END IF;
  IF v_data_inicio > v_data_fim THEN
    RAISE EXCEPTION 'Data inicial não pode ser maior que data final';
  END IF;
  IF v_alvo_tipo NOT IN ('cliente', 'contrato', 'caso', 'itens') THEN
    RAISE EXCEPTION 'Tipo de alvo inválido';
  END IF;
  IF v_alvo_tipo IN ('cliente', 'contrato', 'caso') AND COALESCE(array_length(v_alvo_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'alvo_id/alvo_ids é obrigatório para cliente/contrato/caso';
  END IF;
  INSERT INTO finance.billing_batches (
    tenant_id,
    status,
    alvo_tipo,
    alvo_id,
    data_inicio,
    data_fim,
    created_by,
    updated_by
  )
  VALUES (
    v_tenant_id,
    'em_revisao',
    v_alvo_tipo,
    -- com 'itens' o alvo_id seria um timesheet/despesa, não um cliente/contrato/caso
    CASE WHEN v_alvo_tipo <> 'itens' AND COALESCE(array_length(v_alvo_ids, 1), 0) = 1 THEN v_alvo_ids[1] ELSE NULL END,
    v_data_inicio,
    v_data_fim,
    p_user_id,
    p_user_id
  )
  RETURNING id, numero INTO v_batch_id, v_batch_numero;
  WITH eligible_timesheet AS (
    SELECT
      t.id AS origem_id,
      t.data_lancamento AS data_referencia,
      t.horas AS horas_informadas,
      -- Mesma regra da fila (get_itens_a_faturar): caso com cobranca mensal
      -- ja paga o trabalho, entao a hora vale zero. Se a fila e o gerador
      -- divergirem aqui, a pessoa confere R$ 0 e o item nasce com valor —
      -- foi o que aconteceu com a competencia da hora em 31/08.
      CASE
        WHEN COALESCE(NULLIF(rg.regra, ''), '') IN
             ('mensal', 'mensalidade_processo', 'mensalidade_carteira', 'salario_minimo')
         AND COALESCE((rg.cfg->>'cobra_excedente')::boolean, false) = false
        THEN 0
        ELSE COALESCE(public.resolver_valor_hora(cs.id, t.cargo_id), 0)
      END AS valor_hora,
      c.id AS contrato_id,
      c.numero AS contrato_numero,
      c.nome_contrato,
      cli.id AS cliente_id,
      cli.nome AS cliente_nome,
      cs.id AS caso_id,
      cs.numero AS caso_numero,
      cs.nome AS caso_nome,
      t.descricao AS ts_descricao,
      autor.nome AS ts_autor_nome,
      t.created_by AS ts_autor_user_id
    FROM operations.timesheets t
    JOIN contracts.contratos c
      ON c.id = t.contrato_id
     AND c.tenant_id = v_tenant_id
    JOIN crm.clientes cli
      ON cli.id = c.cliente_id
     AND cli.tenant_id = v_tenant_id
    JOIN contracts.casos cs
      ON cs.id = t.caso_id
     AND cs.tenant_id = v_tenant_id
    CROSS JOIN LATERAL (
      SELECT
        COALESCE(NULLIF(r0.x->>'regra_cobranca', ''), cs.regra_cobranca, '') AS regra,
        COALESCE(r0.x->'regra_cobranca_config', cs.regra_cobranca_config, '{}'::jsonb) AS cfg
      FROM (
        SELECT CASE
          WHEN jsonb_typeof(cs.regras_financeiras) = 'array'
           AND jsonb_array_length(cs.regras_financeiras) > 0
          THEN cs.regras_financeiras->0
          ELSE '{}'::jsonb END AS x
      ) r0
    ) rg
    LEFT JOIN people.colaboradores autor
      ON autor.user_id = t.created_by
     AND autor.tenant_id = v_tenant_id
    WHERE t.tenant_id = v_tenant_id
      -- Hora segue a COMPETENCIA, nao a data em que foi digitada: trabalho de
      -- agosto e cobrado em setembro (Filipe, 31/08 e 01/09, sem excecao).
      -- Precisa ser igual ao filtro de get_itens_a_faturar — se a tela e o
      -- gerador lerem campos diferentes, a fatura sai diferente do que a
      -- pessoa conferiu. Foi o que aconteceu: tela mostrava 1.827 horas e o
      -- gerador pegava 1.
      AND COALESCE(t.periodo_faturamento, t.data_lancamento::date)
          BETWEEN v_data_inicio AND v_data_fim
      AND c.status = 'ativo'
      AND cs.status <> 'inativo'
      AND cs.parte_de_carteira_id IS NULL
      AND (
        v_alvo_tipo = 'itens'
        OR (v_alvo_tipo = 'cliente' AND cli.id = ANY(v_alvo_ids))
        OR (v_alvo_tipo = 'contrato' AND c.id = ANY(v_alvo_ids))
        OR (v_alvo_tipo = 'caso' AND cs.id = ANY(v_alvo_ids))
      )
      -- 28/09: só as horas marcadas na fila
      AND (NOT v_filtra_itens OR t.id = ANY(v_sel_ts))
      AND (
        v_search IS NULL
        OR cli.nome ILIKE '%' || v_search || '%'
        OR c.nome_contrato ILIKE '%' || v_search || '%'
        OR cs.nome ILIKE '%' || v_search || '%'
        OR c.numero::text ILIKE '%' || v_search || '%'
        OR cs.numero::text ILIKE '%' || v_search || '%'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM finance.billing_items bi
        WHERE bi.tenant_id = v_tenant_id
          AND bi.origem_tipo = 'timesheet'
          AND bi.origem_id = t.id
          AND bi.status <> 'cancelado'
      )
  ),
  eligible_rules_source AS (
    SELECT
      c.id AS contrato_id,
      c.numero AS contrato_numero,
      c.nome_contrato,
      cli.id AS cliente_id,
      cli.nome AS cliente_nome,
      cs.id AS caso_id,
      cs.numero AS caso_numero,
      cs.nome AS caso_nome,
      rule_item,
      COALESCE(NULLIF(rule_item->>'id', ''), 'legacy-' || cs.id::text) AS rule_id,
      COALESCE(NULLIF(rule_item->>'regra_cobranca', ''), cs.regra_cobranca, '') AS regra_cobranca,
      COALESCE(rule_item->'regra_cobranca_config', '{}'::jsonb) AS cfg,
      z.dia_inicio_faturamento,
      z.data_inicio_faturamento,
      COALESCE(NULLIF(rule_item->>'status', ''), 'ativo') AS rule_status
    FROM contracts.casos cs
    JOIN contracts.contratos c ON c.id = cs.contrato_id AND c.tenant_id = v_tenant_id
    JOIN crm.clientes cli ON cli.id = c.cliente_id AND cli.tenant_id = v_tenant_id
    CROSS JOIN LATERAL (
      SELECT x AS rule_item
      FROM jsonb_array_elements(
        CASE
          WHEN jsonb_typeof(cs.regras_financeiras) = 'array' AND jsonb_array_length(cs.regras_financeiras) > 0
            THEN cs.regras_financeiras
          ELSE jsonb_build_array(
            jsonb_build_object(
              'id', 'legacy-' || cs.id::text,
              'status', cs.status,
              'regra_cobranca', cs.regra_cobranca,
              'data_inicio_faturamento', cs.data_inicio_faturamento,
              'dia_inicio_faturamento', cs.dia_inicio_faturamento,
              'regra_cobranca_config', COALESCE(cs.regra_cobranca_config, '{}'::jsonb)
            )
          )
        END
      ) AS x
    ) r
    CROSS JOIN LATERAL public.z6_resolve_inicio_faturamento(
      r.rule_item,
      cs.data_inicio_faturamento,
      cs.dia_inicio_faturamento,
      c.created_at::date,
      v_data_inicio
    ) AS z(dia_inicio_faturamento, data_inicio_faturamento)
    WHERE cs.tenant_id = v_tenant_id
      AND c.status = 'ativo'
      AND cs.status <> 'inativo'
      AND cs.parte_de_carteira_id IS NULL
      AND (
        v_alvo_tipo = 'itens'
        OR (v_alvo_tipo = 'cliente' AND cli.id = ANY(v_alvo_ids))
        OR (v_alvo_tipo = 'contrato' AND c.id = ANY(v_alvo_ids))
        OR (v_alvo_tipo = 'caso' AND cs.id = ANY(v_alvo_ids))
      )
      AND (
        v_search IS NULL
        OR cli.nome ILIKE '%' || v_search || '%'
        OR c.nome_contrato ILIKE '%' || v_search || '%'
        OR cs.nome ILIKE '%' || v_search || '%'
        OR c.numero::text ILIKE '%' || v_search || '%'
        OR cs.numero::text ILIKE '%' || v_search || '%'
      )
  ),
  eligible_rules_enriched AS (
    SELECT
      ers.*,
      (
        SELECT sm.valor
        FROM config.salario_minimo sm
        WHERE sm.tenant_id = v_tenant_id
          AND sm.vigencia_desde <= GREATEST(ers.data_inicio_faturamento, v_data_inicio)::date
        ORDER BY sm.vigencia_desde DESC
        LIMIT 1
      ) AS valor_sm_ref
    FROM eligible_rules_source ers
  ),
  eligible_rules_calc AS (
    SELECT
      ers.*,
      finance.rule_origin_uuid(ers.caso_id, ers.rule_id) AS origem_id,
      CASE
        WHEN ers.regra_cobranca IN ('mensal', 'mensalidade_processo') THEN
          COALESCE(NULLIF(ers.cfg->>'valor_mensal', '')::numeric, 0)
          * GREATEST(
              0,
              (
                SELECt count(*)::numeric
                FROM generate_series(
                  date_trunc('month', GREATEST(ers.data_inicio_faturamento, v_data_inicio))::date,
                  date_trunc('month', v_data_fim)::date,
                  interval '1 month'
                ) AS gs(ref_mes)
                -- trava do dia do mes removida — ver comentario em get_itens_a_faturar
              )
            )
        WHEN ers.regra_cobranca = 'mensalidade_carteira' THEN
          COALESCE(NULLIF(ers.cfg->>'valor_mensal_carteira', '')::numeric, 0)
          * GREATEST(
              0,
              (
                SELECt count(*)::numeric
                FROM generate_series(
                  date_trunc('month', GREATEST(ers.data_inicio_faturamento, v_data_inicio))::date,
                  date_trunc('month', v_data_fim)::date,
                  interval '1 month'
                ) AS gs(ref_mes)
                -- trava do dia do mes removida — ver comentario em get_itens_a_faturar
              )
            )
        WHEN ers.regra_cobranca IN ('projeto', 'pro_labore') THEN
          CASE
            WHEN jsonb_typeof(ers.cfg->'parcelas') = 'array' AND jsonb_array_length(ers.cfg->'parcelas') > 0 THEN
              COALESCE((
                SELECT SUM(COALESCE(NULLIF(p->>'valor', '')::numeric, 0))
                FROM jsonb_array_elements(ers.cfg->'parcelas') p
                WHERE NULLIF(p->>'data_pagamento', '')::date BETWEEN v_data_inicio AND v_data_fim
              ), 0)
            WHEN ers.data_inicio_faturamento BETWEEN v_data_inicio AND v_data_fim THEN
              COALESCE(NULLIF(ers.cfg->>'valor_projeto', '')::numeric, 0)
            ELSE 0
          END
        WHEN ers.regra_cobranca = 'exito' THEN
          CASE
            WHEN NULLIF(ers.cfg->>'data_pagamento_exito', '')::date BETWEEN v_data_inicio AND v_data_fim THEN
              COALESCE(
                NULLIF(ers.cfg->>'valor_exito_calculado', '')::numeric,
                (COALESCE(NULLIF(ers.cfg->>'valor_acao', '')::numeric, 0)
                  * COALESCE(NULLIF(ers.cfg->>'percentual_exito', '')::numeric, 0) / 100.0)
              )
            ELSE 0
          END
        WHEN ers.regra_cobranca = 'salario_minimo' THEN
          COALESCE(NULLIF(ers.rule_item->>'quantidade_sm', '')::numeric, NULLIF(ers.cfg->>'quantidade_sm', '')::numeric, 0)
          * COALESCE(ers.valor_sm_ref, 0)
        ELSE 0
      END::numeric(14,2) AS valor_regra
    FROM eligible_rules_enriched ers
    WHERE ers.regra_cobranca IN ('mensal', 'mensalidade_processo', 'mensalidade_carteira', 'projeto', 'pro_labore', 'exito', 'salario_minimo')
      AND ers.rule_status = 'ativo'
  ),
  inserted_timesheet AS (
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
      snapshot,
      created_by,
      updated_by
    )
    SELECT
      v_tenant_id,
      v_batch_id,
      e.cliente_id,
      e.contrato_id,
      e.caso_id,
      'timesheet',
      e.origem_id,
      e.data_referencia,
      v_data_inicio,
      v_data_fim,
      'em_revisao',
      (COALESCE(e.horas_informadas, 0) * COALESCE(e.valor_hora, 0))::numeric(14,2),
      e.horas_informadas,
      jsonb_build_object(
        'cliente_id', e.cliente_id,
        'cliente_nome', e.cliente_nome,
        'contrato_id', e.contrato_id,
        'contrato_numero', e.contrato_numero,
        'contrato_nome', e.nome_contrato,
        'caso_id', e.caso_id,
        'caso_numero', e.caso_numero,
        'caso_nome', e.caso_nome,
        'valor_hora', COALESCE(e.valor_hora, 0),
        'origem', 'timesheet',
        -- autor do lançamento: exibição estável mesmo se o timesheet sumir depois
        'timesheet_profissional', COALESCE(e.ts_autor_nome, ''),
        'timesheet_autor_user_id', e.ts_autor_user_id,
        'timesheet_data_lancamento', e.data_referencia::text,
        'timesheet_descricao', COALESCE(e.ts_descricao, ''),
        'timesheet_horas', COALESCE(e.horas_informadas, 0)
      ),
      p_user_id,
      p_user_id
    FROM eligible_timesheet e
    -- 'Gerar faturamento do mês' não arrasta horas: elas entram quando o
    -- financeiro envia (por caso/contrato) — call de 08/07.
    WHERE NOT v_somente_regras
    RETURNING id
  ),
  inserted_regras AS (
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
      snapshot,
      created_by,
      updated_by
    )
    SELECT
      v_tenant_id,
      v_batch_id,
      r.cliente_id,
      r.contrato_id,
      r.caso_id,
      'regra_financeira',
      r.origem_id,
      GREATEST(r.data_inicio_faturamento, v_data_inicio),
      v_data_inicio,
      v_data_fim,
      'em_revisao',
      COALESCE(r.valor_regra, 0)::numeric(14,2),
      0,
      jsonb_build_object(
        'cliente_id', r.cliente_id,
        'cliente_nome', r.cliente_nome,
        'contrato_id', r.contrato_id,
        'contrato_numero', r.contrato_numero,
        'contrato_nome', r.nome_contrato,
        'caso_id', r.caso_id,
        'caso_numero', r.caso_numero,
        'caso_nome', r.caso_nome,
        'regra_id', r.rule_id,
        'regra_cobranca', r.regra_cobranca,
        'origem', 'regra_financeira',
        'regra', CASE WHEN r.regra_cobranca = 'salario_minimo' THEN 'salario_minimo' ELSE NULL END,
        'quantidade_sm', CASE WHEN r.regra_cobranca = 'salario_minimo' THEN COALESCE(NULLIF(r.rule_item->>'quantidade_sm', '')::numeric, NULLIF(r.cfg->>'quantidade_sm', '')::numeric) ELSE NULL END,
        'valor_sm_no_lancamento', CASE WHEN r.regra_cobranca = 'salario_minimo' THEN r.valor_sm_ref ELSE NULL END
      ),
      p_user_id,
      p_user_id
    FROM eligible_rules_calc r
    WHERE r.valor_regra > 0
      -- 28/09: só as regras marcadas na fila. A fila (get_itens_a_faturar)
      -- mostra UMA linha por mês/parcela/êxito, com origem_id derivado
      -- (rule_origin_uuid(caso, rule_id || ':mensal:YYYYMM' | ':parcela:N' |
      -- ':projeto_unico' | ':exito')); o gerador cria UM item por regra no
      -- período, com origem_id = rule_origin_uuid(caso, rule_id). Então aceita
      -- o id do gerador e qualquer id de linha da fila dessa regra no período.
      -- Como a fila é sempre mensal, marcar a linha = gerar a regra do mês.
      AND (
        NOT v_filtra_itens
        OR r.origem_id = ANY(v_sel_regra)
        OR EXISTS (
          SELECT 1
          FROM (
            SELECT finance.rule_origin_uuid(r.caso_id, r.rule_id || ':mensal:' || to_char(gs.ref_mes, 'YYYYMM')) AS fila_id
            FROM generate_series(
              date_trunc('month', v_data_inicio)::date,
              date_trunc('month', v_data_fim)::date,
              interval '1 month'
            ) AS gs(ref_mes)
            UNION ALL
            SELECT finance.rule_origin_uuid(r.caso_id, r.rule_id || ':parcela:' || p.ord::text)
            FROM jsonb_array_elements(
              CASE WHEN jsonb_typeof(r.cfg->'parcelas') = 'array' THEN r.cfg->'parcelas' ELSE '[]'::jsonb END
            ) WITH ORDINALITY AS p(item, ord)
            UNION ALL
            SELECT finance.rule_origin_uuid(r.caso_id, r.rule_id || ':projeto_unico')
            UNION ALL
            SELECT finance.rule_origin_uuid(r.caso_id, r.rule_id || ':exito')
          ) f
          WHERE f.fila_id = ANY(v_sel_regra)
        )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM finance.billing_items bi
        WHERE bi.tenant_id = v_tenant_id
          AND bi.origem_tipo = 'regra_financeira'
          AND bi.origem_id = r.origem_id
          AND bi.periodo_inicio = v_data_inicio
          AND bi.periodo_fim = v_data_fim
          AND bi.status <> 'cancelado'
      )
    RETURNING id
  )
  SELECT
    COALESCE((SELECT count(*) FROM inserted_timesheet), 0)
    + COALESCE((SELECt count(*) FROM inserted_regras), 0)
  INTO v_items_count;

  -- 28/09: despesas marcadas na fila. A edge só chama o fallback de despesas
  -- quando esta função não cria nada; numa seleção mista (horas + despesas)
  -- as despesas ficariam para trás. Então o fallback roda aqui, com o mesmo
  -- payload (ele filtra por alvo_ids/alvo_chaves), e o lote extra é solto na
  -- hora — igual ao que a edge faz com o lote principal.
  IF v_filtra_itens AND COALESCE(array_length(v_sel_desp, 1), 0) > 0 THEN
    BEGIN
      v_desp := public.start_faturamento_despesas_fallback(p_user_id, p_payload);
      v_desp_count := COALESCE((v_desp->>'itens_criados')::int, 0);
      IF NULLIF(v_desp->>'batch_id', '') IS NOT NULL THEN
        PERFORM public.detach_faturamento_batch(p_user_id, (v_desp->>'batch_id')::uuid);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM ILIKE 'Nenhum item elegível%' THEN
        v_desp_count := 0;
      ELSE
        RAISE;
      END IF;
    END;
  END IF;
  IF v_items_count = 0 AND v_desp_count > 0 THEN
    -- só despesas: o lote de horas/regras nasceu vazio, some
    DELETE FROM finance.billing_batches WHERE id = v_batch_id;
    v_batch_id := NULL;
    v_batch_numero := NULL;
  END IF;
  v_items_count := v_items_count + v_desp_count;

  IF v_items_count = 0 THEN
    DELETE FROM finance.billing_batches WHERE id = v_batch_id;
    -- Gerar do mês é idempotente: se as regras do mês já foram geradas,
    -- responde ok (0 novos) em vez de erro — evita o "não consigo forçar".
    IF v_somente_regras THEN
      RETURN jsonb_build_object(
        'batch_id', NULL,
        'batch_numero', NULL,
        'itens_criados', 0,
        'mensagem', 'Todas as regras do período já estavam geradas — nenhum item novo.'
      );
    END IF;
    RAISE EXCEPTION 'Nenhum item elegível encontrado para o período/filtro';
  END IF;
  UPDATE operations.timesheets t
  SET
    status = 'revisao',
    updated_at = now(),
    updated_by = p_user_id
  WHERE t.tenant_id = v_tenant_id
    AND v_batch_id IS NOT NULL
    AND t.id IN (
      SELECT bi.origem_id
      FROM finance.billing_items bi
      WHERE bi.tenant_id = v_tenant_id
        AND bi.billing_batch_id = v_batch_id
        AND bi.origem_tipo = 'timesheet'
    )
    AND t.status = 'em_lancamento';
  RETURN jsonb_build_object(
    'batch_id', v_batch_id,
    'batch_numero', v_batch_numero,
    'itens_criados', v_items_count
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.start_faturamento_despesas_fallback(p_user_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_tenant_id uuid;
  v_data_inicio date;
  v_data_fim date;
  v_alvo_tipo varchar;
  v_alvo_id uuid;
  v_alvo_ids uuid[] := ARRAY[]::uuid[];
  v_search text;
  v_batch_id uuid;
  v_batch_numero bigint;
  v_items_count int := 0;
  v_can_write boolean := false;
  -- 28/09: seleção de despesas da fila (ver bloco alvo_chaves abaixo)
  v_sel_ts uuid[] := ARRAY[]::uuid[];
  v_sel_desp uuid[] := ARRAY[]::uuid[];
  v_sel_regra uuid[] := ARRAY[]::uuid[];
  v_filtra_itens boolean := false;
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
      'finance.faturamento.write',
      'finance.faturamento.manage',
      'finance.faturamento.*',
      'finance.*',
      '*'
    )
  ) INTO v_can_write;

  IF NOT v_can_write THEN
    RAISE EXCEPTION 'Sem permissão para iniciar fluxo de faturamento';
  END IF;

  v_data_inicio := NULLIF(p_payload->>'data_inicio', '')::date;
  v_data_fim := NULLIF(p_payload->>'data_fim', '')::date;
  v_alvo_tipo := COALESCE(NULLIF(p_payload->>'alvo_tipo', ''), 'itens');
  v_alvo_id := NULLIF(p_payload->>'alvo_id', '')::uuid;
  v_search := NULLIF(trim(COALESCE(p_payload->>'search', '')), '');

  IF jsonb_typeof(p_payload->'alvo_ids') = 'array' THEN
    SELECT COALESCE(array_agg(value::uuid), ARRAY[]::uuid[]) INTO v_alvo_ids
    FROM jsonb_array_elements_text(p_payload->'alvo_ids') AS t(value)
    WHERE value IS NOT NULL
      AND value <> ''
      AND value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
  END IF;

  IF v_alvo_id IS NOT NULL THEN
    v_alvo_ids := array_append(v_alvo_ids, v_alvo_id);
  END IF;

  SELECT COALESCE(array_agg(DISTINCT entry), ARRAY[]::uuid[]) INTO v_alvo_ids
  FROM unnest(v_alvo_ids) AS entry;

  -- 28/09 (Filipe): "selecionar um a um e selecionar todos para liberar em
  -- massa". Com alvo_tipo='itens' a seleção chega por alvo_ids (origem_id da
  -- fila: timesheet.id, despesa.id ou o uuid da regra) e/ou alvo_chaves (os
  -- ids virtuais 'fila:<origem_tipo>:<origem_id>' que get_fila_por_competencia
  -- devolve). alvo_ids não diz o tipo, então vale para os três; alvo_chaves
  -- entra só no tipo que declara. Sem nenhum dos dois, 'itens' segue liberando
  -- o tenant inteiro (comportamento antigo).
  IF v_alvo_tipo = 'itens' THEN
    v_sel_ts := v_alvo_ids;
    v_sel_desp := v_alvo_ids;
    v_sel_regra := v_alvo_ids;
    IF jsonb_typeof(p_payload->'alvo_chaves') = 'array' THEN
      SELECT
        v_sel_ts || COALESCE(array_agg(m.origem) FILTER (WHERE m.tipo = 'timesheet'), ARRAY[]::uuid[]),
        v_sel_desp || COALESCE(array_agg(m.origem) FILTER (WHERE m.tipo = 'despesa'), ARRAY[]::uuid[]),
        v_sel_regra || COALESCE(array_agg(m.origem) FILTER (WHERE m.tipo NOT IN ('timesheet', 'despesa')), ARRAY[]::uuid[])
      INTO v_sel_ts, v_sel_desp, v_sel_regra
      FROM (
        SELECT split_part(value, ':', 2) AS tipo, split_part(value, ':', 3)::uuid AS origem
        FROM jsonb_array_elements_text(p_payload->'alvo_chaves') AS t(value)
        WHERE value ~* '^fila:[a-z_]+:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      ) m;
    END IF;
    v_filtra_itens := COALESCE(array_length(v_sel_ts, 1), 0)
                    + COALESCE(array_length(v_sel_desp, 1), 0)
                    + COALESCE(array_length(v_sel_regra, 1), 0) > 0;
  END IF;

  IF v_data_inicio IS NULL OR v_data_fim IS NULL THEN
    RAISE EXCEPTION 'Informe data inicial e final';
  END IF;

  IF v_data_inicio > v_data_fim THEN
    RAISE EXCEPTION 'Data inicial não pode ser maior que data final';
  END IF;

  IF v_alvo_tipo NOT IN ('cliente', 'contrato', 'caso', 'itens') THEN
    RAISE EXCEPTION 'Tipo de alvo inválido';
  END IF;

  IF v_alvo_tipo IN ('cliente', 'contrato', 'caso') AND COALESCE(array_length(v_alvo_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'alvo_id/alvo_ids é obrigatório para cliente/contrato/caso';
  END IF;

  -- Sincroniza cliente_id legado para garantir elegibilidade consistente.
  UPDATE operations.despesas d
  SET cliente_id = c.cliente_id
  FROM contracts.contratos c
  WHERE c.id = d.contrato_id
    AND c.tenant_id = d.tenant_id
    AND d.tenant_id = v_tenant_id
    AND (d.cliente_id IS NULL OR d.cliente_id <> c.cliente_id);

  INSERT INTO finance.billing_batches (
    tenant_id,
    status,
    alvo_tipo,
    alvo_id,
    data_inicio,
    data_fim,
    created_by,
    updated_by
  )
  VALUES (
    v_tenant_id,
    'em_revisao',
    v_alvo_tipo,
    CASE WHEN v_alvo_tipo <> 'itens' AND COALESCE(array_length(v_alvo_ids, 1), 0) = 1 THEN v_alvo_ids[1] ELSE NULL END,
    v_data_inicio,
    v_data_fim,
    p_user_id,
    p_user_id
  )
  RETURNING id, numero INTO v_batch_id, v_batch_numero;

  WITH eligible_despesas AS (
    SELECT
      d.id AS origem_id,
      d.data_lancamento AS data_referencia,
      COALESCE(d.valor, 0)::numeric(14,2) AS valor_informado,
      d.categoria,
      d.descricao,
      c.id AS contrato_id,
      c.numero AS contrato_numero,
      c.nome_contrato,
      COALESCE(d.cliente_id, c.cliente_id) AS cliente_id,
      cli.nome AS cliente_nome,
      cs.id AS caso_id,
      cs.numero AS caso_numero,
      cs.nome AS caso_nome
    FROM operations.despesas d
    JOIN contracts.contratos c
      ON c.id = d.contrato_id
     AND c.tenant_id = v_tenant_id
    JOIN crm.clientes cli
      ON cli.id = COALESCE(d.cliente_id, c.cliente_id)
     AND cli.tenant_id = v_tenant_id
    JOIN contracts.casos cs
      ON cs.id = d.caso_id
     AND cs.tenant_id = v_tenant_id
    WHERE d.tenant_id = v_tenant_id
      -- Competencia, nao data do gasto: despesa de agosto e cobrada em
      -- setembro. Igual ao que start_faturamento_flow faz com a hora — se a
      -- tela e o gerador lerem campos diferentes, sai fatura diferente da que
      -- a pessoa conferiu.
      AND COALESCE(d.periodo_faturamento, d.data_lancamento) BETWEEN v_data_inicio AND v_data_fim
      AND d.status IN ('em_lancamento', 'revisao', 'aprovado')
      AND COALESCE(d.reembolsavel, true) = true
      AND c.status = 'ativo'
      AND cs.status <> 'inativo'
      AND (
        v_alvo_tipo = 'itens'
        OR (v_alvo_tipo = 'cliente' AND COALESCE(d.cliente_id, c.cliente_id) = ANY(v_alvo_ids))
        OR (v_alvo_tipo = 'contrato' AND c.id = ANY(v_alvo_ids))
        OR (v_alvo_tipo = 'caso' AND cs.id = ANY(v_alvo_ids))
      )
      -- 28/09: só as despesas marcadas na fila
      AND (NOT v_filtra_itens OR d.id = ANY(v_sel_desp))
      AND (
        v_search IS NULL
        OR cli.nome ILIKE '%' || v_search || '%'
        OR c.nome_contrato ILIKE '%' || v_search || '%'
        OR cs.nome ILIKE '%' || v_search || '%'
        OR COALESCE(d.categoria, '') ILIKE '%' || v_search || '%'
        OR COALESCE(d.descricao, '') ILIKE '%' || v_search || '%'
        OR c.numero::text ILIKE '%' || v_search || '%'
        OR cs.numero::text ILIKE '%' || v_search || '%'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM finance.billing_items bi
        WHERE bi.tenant_id = v_tenant_id
          AND bi.origem_tipo = 'despesa'
          AND bi.origem_id = d.id
          AND bi.status <> 'cancelado'
      )
  ),
  inserted_despesas AS (
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
      snapshot,
      created_by,
      updated_by
    )
    SELECT
      v_tenant_id,
      v_batch_id,
      d.cliente_id,
      d.contrato_id,
      d.caso_id,
      'despesa',
      d.origem_id,
      d.data_referencia,
      v_data_inicio,
      v_data_fim,
      'em_revisao',
      d.valor_informado,
      0,
      jsonb_build_object(
        'cliente_id', d.cliente_id,
        'cliente_nome', d.cliente_nome,
        'contrato_id', d.contrato_id,
        'contrato_numero', d.contrato_numero,
        'contrato_nome', d.nome_contrato,
        'caso_id', d.caso_id,
        'caso_numero', d.caso_numero,
        'caso_nome', d.caso_nome,
        'regra_nome', 'Despesa',
        'regra_cobranca', 'despesa',
        'categoria', d.categoria,
        'descricao', COALESCE(d.descricao, d.categoria, 'Despesa'),
        'origem', 'despesa'
      ),
      p_user_id,
      p_user_id
    FROM eligible_despesas d
    RETURNING origem_id
  )
  SELECT COUNT(*)::int INTO v_items_count
  FROM inserted_despesas;

  IF v_items_count = 0 THEN
    DELETE FROM finance.billing_batches WHERE id = v_batch_id;
    RAISE EXCEPTION 'Nenhum item elegível encontrado para o período/filtro';
  END IF;

  UPDATE operations.despesas d
  SET
    status = 'revisao',
    updated_at = now(),
    updated_by = p_user_id
  WHERE d.tenant_id = v_tenant_id
    AND d.id IN (SELECT origem_id FROM finance.billing_items WHERE tenant_id = v_tenant_id AND billing_batch_id = v_batch_id AND origem_tipo = 'despesa')
    AND d.status = 'em_lancamento';

  RETURN jsonb_build_object(
    'batch_id', v_batch_id,
    'batch_numero', v_batch_numero,
    'itens_criados', v_items_count
  );
END;
$function$
;

-- ---------------------------------------------------------------------------
-- 2. Devolver para revisão reinicia a partir da aprovação
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.excluir_kit(p_user_id uuid, p_caso_id uuid, p_contrato_id uuid, p_competencia date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'finance', 'contracts', 'operations', 'people', 'core'
AS $function$
DECLARE
  v_tenant uuid;
  v_competencia date := date_trunc('month', p_competencia)::date;
  v_item_ids uuid[];
  v_nota record;
  v_nome text;
  v_itens int := 0;
  v_ts int := 0;
  v_docs int := 0;
  v_nf_erro int := 0;
  v_kit int := 0;
BEGIN
  SELECT tenant_id INTO v_tenant FROM core.tenant_users
   WHERE user_id = p_user_id AND status = 'ativo' LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem tenant'; END IF;
  IF NOT finance._kit_pode_operar(p_user_id) THEN
    RAISE EXCEPTION 'Sem permissão para excluir o kit';
  END IF;
  IF p_contrato_id IS NULL OR v_competencia IS NULL THEN
    RAISE EXCEPTION 'Contrato e competência são obrigatórios';
  END IF;

  -- Itens do kit: aprovado/faturado do caso (ou "Sem caso" do contrato) na
  -- competência — mesma regra de competência de get_revisao_fatura.
  SELECT array_agg(bi.id) INTO v_item_ids
    FROM finance.billing_items bi
   WHERE bi.tenant_id = v_tenant
     AND bi.status IN ('aprovado', 'faturado')
     AND bi.contrato_id = p_contrato_id
     AND bi.caso_id IS NOT DISTINCT FROM p_caso_id
     AND date_trunc('month', COALESCE(bi.periodo_inicio, bi.created_at::date))::date = v_competencia;

  IF v_item_ids IS NULL OR array_length(v_item_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'itens_devolvidos', 0,
                              'motivo', 'Nenhum item aprovado neste kit');
  END IF;

  -- Bloqueio 1: NFS-e autorizada ou em processamento sobre esses itens.
  SELECT bn.id, bn.numero, bn.focus_status,
         COALESCE(NULLIF(bn.metadata->'nfse_consulta'->>'numero_nfse', ''),
                  NULLIF(bn.metadata->>'nfse_numero', ''),
                  bn.numero::text) AS nfse_numero
    INTO v_nota
    FROM finance.billing_notes bn
   WHERE bn.tenant_id = v_tenant
     AND bn.tipo_documento = 'nota_fiscal_servico'
     AND bn.status = 'gerado'
     AND bn.focus_status IN ('autorizado', 'processando')
     AND EXISTS (
       SELECT 1 FROM jsonb_array_elements_text(COALESCE(bn.metadata->'item_ids', '[]'::jsonb)) x
       WHERE x.value::uuid = ANY (v_item_ids)
     )
   ORDER BY bn.created_at DESC
   LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', false, 'itens_devolvidos', 0,
      'motivo', CASE WHEN v_nota.focus_status = 'autorizado'
                     THEN 'NFS-e ' || v_nota.nfse_numero || ' autorizada'
                     ELSE 'NFS-e ' || v_nota.nfse_numero || ' em processamento' END);
  END IF;

  -- Bloqueio 2: boleto vivo (registrado/emitido/pago/liquidado) numa conta a
  -- receber de qualquer NFS-e desses itens — inclusive de nota já cancelada,
  -- porque o boleto continua no banco.
  IF EXISTS (
    SELECT 1
      FROM finance.billing_notes bn
      JOIN finance.lancamentos l ON l.tenant_id = bn.tenant_id
                                AND l.origem = 'faturamento' AND l.origem_ref_id = bn.id
      JOIN finance.boletos b ON b.lancamento_id = l.id
     WHERE bn.tenant_id = v_tenant
       AND bn.tipo_documento = 'nota_fiscal_servico'
       AND b.status NOT IN ('cancelado', 'erro', 'baixado')
       AND EXISTS (
         SELECT 1 FROM jsonb_array_elements_text(COALESCE(bn.metadata->'item_ids', '[]'::jsonb)) x
         WHERE x.value::uuid = ANY (v_item_ids)
       )
  ) THEN
    RETURN jsonb_build_object('ok', false, 'itens_devolvidos', 0, 'motivo', 'Boleto registrado');
  END IF;

  SELECT c.nome INTO v_nome FROM people.colaboradores c
   WHERE c.user_id = p_user_id AND c.tenant_id = v_tenant LIMIT 1;

  -- Rastro no histórico do item (mesma tabela que a revisão mostra).
  INSERT INTO finance.revisao_fatura_itens_historico (
    billing_item_id, role, author_id, author_name, horas, valor, texto, tenant_id, created_at
  )
  SELECT bi.id, 'APROVADOR', p_user_id, COALESCE(v_nome, 'Usuário'),
         COALESCE(bi.horas_aprovadas, bi.horas_revisadas, bi.horas_informadas, 0),
         COALESCE(bi.valor_aprovado, bi.valor_revisado, bi.valor_informado, 0),
         'Kit excluído da Composição da fatura (competência '
           || to_char(v_competencia, 'MM/YYYY') || '): item devolvido para aprovação (revisão preservada)',
         v_tenant, now()
    FROM finance.billing_items bi
   WHERE bi.id = ANY (v_item_ids);

  -- Volta para a etapa de aprovação (em_aprovacao), NÃO para o início: a
  -- revisão (valor_revisado, horas_revisadas, responsavel_revisao_id,
  -- data_revisao) fica como estava e só a aprovação é limpa. Filipe, 28/09:
  -- "reinicia toda a jornada a partir da aprovação e nunca do lançamento
  -- original, senão perdemos as infos de revisão e aprovação".
  UPDATE finance.billing_items bi
     SET status = 'em_aprovacao',
         valor_aprovado = NULL,
         horas_aprovadas = NULL,
         data_aprovacao = NULL,
         responsavel_aprovacao_id = NULL,
         updated_at = now(),
         updated_by = p_user_id
   WHERE bi.id = ANY (v_item_ids);
  GET DIAGNOSTICS v_itens = ROW_COUNT;

  UPDATE operations.timesheets t
     SET status = 'revisao', updated_at = now(), updated_by = p_user_id
   WHERE t.tenant_id = v_tenant
     AND t.status = 'aprovado'
     AND t.id IN (
       SELECT bi.origem_id FROM finance.billing_items bi
        WHERE bi.id = ANY (v_item_ids) AND bi.origem_tipo = 'timesheet'
     );
  GET DIAGNOSTICS v_ts = ROW_COUNT;

  -- Documentos do kit (relatório de timesheet, nota de débito) saem junto.
  UPDATE finance.billing_notes bn
     SET status = 'cancelado'
   WHERE bn.tenant_id = v_tenant
     AND bn.tipo_documento IN ('relatorio_timesheet', 'nota_debito')
     AND bn.status = 'gerado'
     AND bn.contrato_id = p_contrato_id
     AND bn.caso_id IS NOT DISTINCT FROM p_caso_id
     AND NULLIF(bn.metadata->>'competencia', '')::date = v_competencia;
  GET DIAGNOSTICS v_docs = ROW_COUNT;

  -- NFS-e que ficou em erro sobre esses itens: cancela o registro (não é
  -- ato fiscal — nunca chegou a existir na prefeitura).
  UPDATE finance.billing_notes bn
     SET status = 'cancelado'
   WHERE bn.tenant_id = v_tenant
     AND bn.tipo_documento = 'nota_fiscal_servico'
     AND bn.status = 'gerado'
     AND bn.focus_status IN ('erro', 'erro_autorizacao')
     AND EXISTS (
       SELECT 1 FROM jsonb_array_elements_text(COALESCE(bn.metadata->'item_ids', '[]'::jsonb)) x
       WHERE x.value::uuid = ANY (v_item_ids)
     );
  GET DIAGNOSTICS v_nf_erro = ROW_COUNT;

  -- Estado do kit (finalizado / ajustes) some com o kit (24/09).
  DELETE FROM finance.kits k
   WHERE k.tenant_id = v_tenant
     AND k.contrato_id = p_contrato_id
     AND k.caso_id IS NOT DISTINCT FROM p_caso_id
     AND k.competencia = v_competencia;
  GET DIAGNOSTICS v_kit = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'itens_devolvidos', v_itens,
    'horas_devolvidas', v_ts,
    'documentos_cancelados', v_docs,
    'nfse_erro_canceladas', v_nf_erro,
    'kit_apagado', v_kit > 0,
    'motivo', NULL
  );
END $function$
;

-- ---------------------------------------------------------------------------
-- 3. finance.boletos: 'cancelado' no CHECK de status
-- ---------------------------------------------------------------------------
-- A composição, types.ts e cliente-card já tratam 'cancelado'; só o CHECK não
-- deixava gravar. Sem baixa no Itaú nesta rodada — só a lista.
ALTER TABLE finance.boletos DROP CONSTRAINT IF EXISTS boletos_status_chk;
ALTER TABLE finance.boletos ADD CONSTRAINT boletos_status_chk
  CHECK (status = ANY (ARRAY['preparado'::text, 'registrado'::text, 'erro'::text, 'liquidado'::text, 'baixado'::text, 'cancelado'::text]));
