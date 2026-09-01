-- Valor da hora aparece na conferencia (pedido Filipe, 01/09):
-- "informar o valor da hora conforme regra de cobranca, isso vai nos ajudar
-- na conferencia manual".
--
-- O numero sai de resolver_valor_hora — o mesmo que calculou o valor — e nao de
-- valor/horas na tela. Dividir arredonda (mostraria 499,99 onde a regra diz
-- 500) e esconderia que a taxa varia por cargo, o que acontece em 9 casos.

CREATE OR REPLACE FUNCTION public.get_itens_a_faturar(p_user_id uuid, p_data_inicio date, p_data_fim date, p_search text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_tenant_id uuid;
BEGIN
  SELECT tenant_id INTO v_tenant_id
  FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id AND tu.status = 'ativo'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não associado a tenant';
  END IF;

  IF p_data_inicio IS NULL OR p_data_fim IS NULL THEN
    RAISE EXCEPTION 'Informe data inicial e final';
  END IF;

  IF p_data_inicio > p_data_fim THEN
    RAISE EXCEPTION 'Data inicial não pode ser maior que data final';
  END IF;

  RETURN (
    WITH base_timesheet AS (
      SELECT
        t.id AS origem_id,
        t.data_lancamento::date AS data_referencia,
        t.horas::numeric(12,2) AS horas,
        (
          COALESCE(t.horas, 0)
          * COALESCE(public.resolver_valor_hora(cs.id, t.cargo_id), 0)
        )::numeric(14,2) AS valor,
        c.id AS contrato_id,
        c.numero AS contrato_numero,
        c.numero_sequencial AS contrato_numero_sequencial,
        c.nome_contrato,
        cli.id AS cliente_id,
        cli.nome AS cliente_nome,
        cs.id AS caso_id,
        cs.numero AS caso_numero,
        cs.nome AS caso_nome,
        'timesheet'::text AS item_tipo,
        -- aba Horas só quando o caso cobra por hora; sem regra => sem aba (Todas)
        (CASE
          WHEN EXISTS (
            SELECT 1 FROM jsonb_array_elements(
              CASE WHEN jsonb_typeof(cs.regras_financeiras) = 'array' THEN cs.regras_financeiras ELSE '[]'::jsonb END
            ) r
            WHERE COALESCE(NULLIF(r->>'status',''),'ativo') = 'ativo'
              AND NULLIF(r->>'regra_cobranca','') IN ('hora','hora_com_cap')
          ) OR NULLIF(cs.regra_cobranca,'') IN ('hora','hora_com_cap') THEN 'hora'
          ELSE COALESCE(
            (
              SELECT NULLIF(r->>'regra_cobranca','') FROM jsonb_array_elements(
                CASE WHEN jsonb_typeof(cs.regras_financeiras) = 'array' THEN cs.regras_financeiras ELSE '[]'::jsonb END
              ) r
              WHERE COALESCE(NULLIF(r->>'status',''),'ativo') = 'ativo'
                AND NULLIF(r->>'regra_cobranca','') IS NOT NULL
              LIMIT 1
            ),
            NULLIF(cs.regra_cobranca, '')
          )
        END)::text AS caso_regra,
        COALESCE(NULLIF(t.descricao, ''), 'Timesheet - ' || to_char(t.data_lancamento::date, 'DD/MM/YYYY'))::text AS descricao,
        -- Valor da hora usado no calculo, para a conferencia manual (Filipe,
        -- 01/09). Vem de quem calculou, nao de valor/horas na tela: a divisao
        -- arredonda e mostraria 499,99 onde a regra diz 500. A taxa varia por
        -- cargo em 9 casos, entao dividir tambem esconderia essa variacao.
        --
        -- Posicao importa: UNION casa coluna por POSICAO, e os demais ramos
        -- trazem NULL aqui. Fora de ordem, o valor da hora cairia na coluna de
        -- quem lancou.
        COALESCE(public.resolver_valor_hora(cs.id, t.cargo_id), 0)::numeric(14,2) AS valor_hora,
        COALESCE(aut.nome, '')::text AS lancado_por
      FROM operations.timesheets t
      LEFT JOIN people.colaboradores aut ON aut.user_id = t.created_by AND aut.tenant_id = v_tenant_id
      JOIN contracts.contratos c ON c.id = t.contrato_id AND c.tenant_id = v_tenant_id
      JOIN crm.clientes cli ON cli.id = c.cliente_id AND cli.tenant_id = v_tenant_id
      JOIN contracts.casos cs ON cs.id = t.caso_id AND cs.tenant_id = v_tenant_id
      WHERE t.tenant_id = v_tenant_id
        -- Periodo efetivo: data do trabalho, a menos que tenha sido postergado
        -- para outro mes (postergar_timesheet) — ai vale a data escolhida.
        AND COALESCE(t.periodo_faturamento, t.data_lancamento::date) BETWEEN p_data_inicio AND p_data_fim
        AND c.status = 'ativo'
        AND cs.status <> 'inativo'
        AND NOT t.excluido_faturamento
        AND NOT EXISTS (
          SELECT 1
          FROM finance.billing_items bi
          WHERE bi.tenant_id = v_tenant_id
            AND bi.origem_tipo = 'timesheet'
            AND bi.origem_id = t.id
            AND bi.status <> 'cancelado'
        )
        AND (
          p_search IS NULL
          OR trim(p_search) = ''
          OR cli.nome ILIKE '%' || trim(p_search) || '%'
          OR c.nome_contrato ILIKE '%' || trim(p_search) || '%'
          OR cs.nome ILIKE '%' || trim(p_search) || '%'
          OR c.numero::text ILIKE '%' || trim(p_search) || '%'
          OR cs.numero::text ILIKE '%' || trim(p_search) || '%'
        )
    ),
    rules_source AS (
      SELECT
        c.id AS contrato_id,
        c.numero AS contrato_numero,
        c.numero_sequencial AS contrato_numero_sequencial,
        c.nome_contrato,
        cli.id AS cliente_id,
        cli.nome AS cliente_nome,
        cs.id AS caso_id,
        cs.numero AS caso_numero,
        cs.nome AS caso_nome,
        cs.parte_de_carteira_id,
        COALESCE(NULLIF(rule_item->>'id', ''), 'legacy-' || cs.id::text) AS rule_id,
        COALESCE(NULLIF(rule_item->>'regra_cobranca', ''), cs.regra_cobranca, '') AS regra_cobranca,
        COALESCE(rule_item->'regra_cobranca_config', '{}'::jsonb) AS cfg,
        z.dia_inicio_faturamento,
        z.data_inicio_faturamento,
        COALESCE(NULLIF(rule_item->>'status', ''), 'ativo') AS rule_status,
        finance.rule_origin_uuid(cs.id, COALESCE(NULLIF(rule_item->>'id', ''), 'legacy-' || cs.id::text)) AS origem_regra_id
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
        p_data_inicio
      ) AS z(dia_inicio_faturamento, data_inicio_faturamento)
      WHERE cs.tenant_id = v_tenant_id
        AND c.status = 'ativo'
        AND cs.status = 'ativo'
        AND (
          p_search IS NULL
          OR trim(p_search) = ''
          OR cli.nome ILIKE '%' || trim(p_search) || '%'
          OR c.nome_contrato ILIKE '%' || trim(p_search) || '%'
          OR cs.nome ILIKE '%' || trim(p_search) || '%'
          OR c.numero::text ILIKE '%' || trim(p_search) || '%'
          OR cs.numero::text ILIKE '%' || trim(p_search) || '%'
        )
    ),
    regra_mensal_itens AS (
      SELECT
        finance.rule_origin_uuid(rs.caso_id, rs.rule_id || ':mensal:' || to_char(gs.ref_mes, 'YYYYMM')) AS origem_id,
        rs.origem_regra_id,
        gs.ref_mes::date AS data_referencia,
        0::numeric(12,2) AS horas,
        val.valor::numeric(14,2) AS valor,
        rs.contrato_id,
        rs.contrato_numero,
        rs.contrato_numero_sequencial,
        rs.nome_contrato,
        rs.cliente_id,
        rs.cliente_nome,
        rs.caso_id,
        rs.caso_numero,
        rs.caso_nome,
        -- salário mínimo é apresentado como "Mensalidade de processo" no app (form),
        -- então cai na mesma aba da grid.
        CASE
          WHEN rs.regra_cobranca = 'salario_minimo' THEN 'mensalidade_processo'
          WHEN rs.regra_cobranca = 'mensalidade_carteira' THEN 'mensal'
          ELSE rs.regra_cobranca
        END AS item_tipo,
        (
          CASE
            WHEN rs.regra_cobranca IN ('mensalidade_processo', 'salario_minimo') THEN 'Mensalidade de processo'
            WHEN rs.regra_cobranca = 'mensalidade_carteira' THEN 'Mensalidade de carteira'
            ELSE 'Mensalidade'
          END
          || ' - ' || to_char(gs.ref_mes, 'MM/YYYY')
        )::text AS descricao,
        NULL::numeric(14,2) AS valor_hora,
        ''::text AS lancado_por
      FROM rules_source rs
      JOIN LATERAL (
        SELECT generate_series(
          date_trunc('month', GREATEST(rs.data_inicio_faturamento, p_data_inicio))::date,
          date_trunc('month', p_data_fim)::date,
          interval '1 month'
        )::date AS ref_mes
      ) gs ON true
      CROSS JOIN LATERAL (
        SELECT (
          CASE
            WHEN rs.regra_cobranca = 'salario_minimo' THEN
              COALESCE(NULLIF(rs.cfg->>'quantidade_sm', '')::numeric, 0)
              * COALESCE(
                  (SELECT sm.valor FROM config.salario_minimo sm
                    WHERE sm.tenant_id = v_tenant_id AND sm.vigencia_desde <= gs.ref_mes
                    ORDER BY sm.vigencia_desde DESC LIMIT 1),
                  (SELECT sm.valor FROM config.salario_minimo sm
                    WHERE sm.tenant_id = v_tenant_id
                    ORDER BY sm.vigencia_desde DESC LIMIT 1),
                  0
                )
            WHEN rs.regra_cobranca = 'mensalidade_carteira' THEN
              COALESCE(NULLIF(rs.cfg->>'valor_mensal_carteira', '')::numeric, 0)
            ELSE COALESCE(NULLIF(rs.cfg->>'valor_mensal', '')::numeric, 0)
          END
        ) AS valor
      ) val
      WHERE rs.rule_status = 'ativo'
        AND rs.regra_cobranca IN ('mensal', 'mensalidade_processo', 'salario_minimo', 'mensalidade_carteira')
        -- Só a matriz da carteira fatura; os processos dentro dela já estão no
        -- valor dela. Mesma trava que start_faturamento_flow sempre teve — sem
        -- ela, o dia em que alguém montar uma carteira com filhos a fila cobra
        -- duas vezes.
        AND (rs.regra_cobranca <> 'mensalidade_carteira' OR rs.parte_de_carteira_id IS NULL)
        AND val.valor > 0
        -- A trava do "so entra depois do dia X do mes corrente" saiu daqui.
        -- Filipe, 01/09: "cobra-se as horas no comeco do mes corrente" e
        -- "quero cobrar as mensalidades de setembro no comeco do mes". Com ela,
        -- gerar no dia 1o trazia ZERO mensalidade — o dia cadastrado no caso
        -- ainda nao tinha chegado.
    ),
    regra_projeto_parcelas AS (
      SELECT
        finance.rule_origin_uuid(rs.caso_id, rs.rule_id || ':parcela:' || p.ord::text) AS origem_id,
        rs.origem_regra_id,
        NULLIF(p.item->>'data_pagamento', '')::date AS data_referencia,
        0::numeric(12,2) AS horas,
        COALESCE(NULLIF(p.item->>'valor', '')::numeric, 0)::numeric(14,2) AS valor,
        rs.contrato_id,
        rs.contrato_numero,
        rs.contrato_numero_sequencial,
        rs.nome_contrato,
        rs.cliente_id,
        rs.cliente_nome,
        rs.caso_id,
        rs.caso_numero,
        rs.caso_nome,
        'projeto_parcela'::text AS item_tipo,
        ('Projeto - Parcela ' || p.ord::text)::text AS descricao,
        NULL::numeric(14,2) AS valor_hora,
        ''::text AS lancado_por
      FROM rules_source rs
      CROSS JOIN LATERAL jsonb_array_elements(rs.cfg->'parcelas') WITH ORDINALITY AS p(item, ord)
      WHERE rs.rule_status = 'ativo'
        AND rs.regra_cobranca IN ('projeto', 'pro_labore')
        AND jsonb_typeof(rs.cfg->'parcelas') = 'array'
        AND jsonb_array_length(rs.cfg->'parcelas') > 0
        AND NULLIF(p.item->>'data_pagamento', '')::date BETWEEN p_data_inicio AND p_data_fim
        AND COALESCE(NULLIF(p.item->>'valor', '')::numeric, 0) > 0
    ),
    regra_projeto_unico AS (
      SELECT
        finance.rule_origin_uuid(rs.caso_id, rs.rule_id || ':projeto_unico') AS origem_id,
        rs.origem_regra_id,
        rs.data_inicio_faturamento::date AS data_referencia,
        0::numeric(12,2) AS horas,
        COALESCE(NULLIF(rs.cfg->>'valor_projeto', '')::numeric, 0)::numeric(14,2) AS valor,
        rs.contrato_id,
        rs.contrato_numero,
        rs.contrato_numero_sequencial,
        rs.nome_contrato,
        rs.cliente_id,
        rs.cliente_nome,
        rs.caso_id,
        rs.caso_numero,
        rs.caso_nome,
        'projeto'::text AS item_tipo,
        'Projeto - Valor único'::text AS descricao,
        NULL::numeric(14,2) AS valor_hora,
        ''::text AS lancado_por
      FROM rules_source rs
      WHERE rs.rule_status = 'ativo'
        AND rs.regra_cobranca IN ('projeto', 'pro_labore')
        AND (
          jsonb_typeof(rs.cfg->'parcelas') <> 'array'
          OR jsonb_array_length(rs.cfg->'parcelas') = 0
        )
        AND rs.data_inicio_faturamento BETWEEN p_data_inicio AND p_data_fim
        AND COALESCE(NULLIF(rs.cfg->>'valor_projeto', '')::numeric, 0) > 0
    ),
    regra_exito AS (
      SELECT
        finance.rule_origin_uuid(rs.caso_id, rs.rule_id || ':exito') AS origem_id,
        rs.origem_regra_id,
        NULLIF(rs.cfg->>'data_pagamento_exito', '')::date AS data_referencia,
        0::numeric(12,2) AS horas,
        COALESCE(
          NULLIF(rs.cfg->>'valor_exito_calculado', '')::numeric,
          (
            COALESCE(NULLIF(rs.cfg->>'valor_acao', '')::numeric, 0)
            * COALESCE(NULLIF(rs.cfg->>'percentual_exito', '')::numeric, 0)
            / 100.0
          )
        )::numeric(14,2) AS valor,
        rs.contrato_id,
        rs.contrato_numero,
        rs.contrato_numero_sequencial,
        rs.nome_contrato,
        rs.cliente_id,
        rs.cliente_nome,
        rs.caso_id,
        rs.caso_numero,
        rs.caso_nome,
        'exito'::text AS item_tipo,
        'Êxito'::text AS descricao,
        NULL::numeric(14,2) AS valor_hora,
        ''::text AS lancado_por
      FROM rules_source rs
      WHERE rs.rule_status = 'ativo'
        AND rs.regra_cobranca = 'exito'
        AND NULLIF(rs.cfg->>'data_pagamento_exito', '')::date BETWEEN p_data_inicio AND p_data_fim
        AND COALESCE(
          NULLIF(rs.cfg->>'valor_exito_calculado', '')::numeric,
          (
            COALESCE(NULLIF(rs.cfg->>'valor_acao', '')::numeric, 0)
            * COALESCE(NULLIF(rs.cfg->>'percentual_exito', '')::numeric, 0)
            / 100.0
          )
        ) > 0
    ),
    -- Linhas adiadas PARA este periodo. Vem do snapshot guardado no
    -- adiamento: a regra do contrato so gera linha para o mes de competencia,
    -- entao sem o snapshot uma mensalidade de agosto adiada para outubro
    -- simplesmente nao existiria em outubro.
    regra_adiados_entrando AS (
      SELECT
        a.origem_id,
        NULL::uuid AS origem_regra_id,
        COALESCE(a.data_referencia, a.periodo_novo) AS data_referencia,
        0::numeric(12,2) AS horas,
        a.valor::numeric(14,2) AS valor,
        ct.id AS contrato_id,
        ct.numero AS contrato_numero,
        ct.numero_sequencial AS contrato_numero_sequencial,
        ct.nome_contrato,
        cl.id AS cliente_id,
        cl.nome AS cliente_nome,
        cs.id AS caso_id,
        cs.numero AS caso_numero,
        cs.nome AS caso_nome,
        a.item_tipo,
        (a.descricao || ' (adiado de ' || to_char(a.competencia, 'MM/YYYY') || ')')::text AS descricao,
        NULL::numeric(14,2) AS valor_hora,
        ''::text AS lancado_por
      FROM finance.faturamento_adiamentos a
      JOIN contracts.casos cs ON cs.id = a.caso_id
      JOIN contracts.contratos ct ON ct.id = cs.contrato_id
      JOIN crm.clientes cl ON cl.id = ct.cliente_id
      WHERE a.tenant_id = v_tenant_id
        AND a.desfeito_em IS NULL
        AND a.periodo_novo BETWEEN date_trunc('month', p_data_inicio)::date AND p_data_fim
    ),
    regra_itens_raw AS (
      SELECT * FROM regra_adiados_entrando
      UNION ALL
      SELECT * FROM regra_mensal_itens
      UNION ALL
      SELECT * FROM regra_projeto_parcelas
      UNION ALL
      SELECT * FROM regra_projeto_unico
      UNION ALL
      SELECT * FROM regra_exito
    ),
    regra_itens AS (
      SELECT r.*
      FROM regra_itens_raw r
      WHERE NOT EXISTS (
        SELECT 1
        FROM finance.billing_items bi
        WHERE bi.tenant_id = v_tenant_id
          AND bi.origem_tipo = 'regra_financeira'
          AND bi.periodo_inicio = p_data_inicio
          AND bi.periodo_fim = p_data_fim
          AND bi.status <> 'cancelado'
          AND (bi.origem_id = r.origem_id OR bi.origem_id = r.origem_regra_id)
      )
      -- Adiada para outro mes: sai da fila deste. O proprio adiamento a
      -- devolve no mes de destino, via regra_adiados_entrando.
      AND NOT EXISTS (
        SELECT 1 FROM finance.faturamento_adiamentos a
        WHERE a.tenant_id = v_tenant_id
          AND a.origem_id = r.origem_id
          AND a.desfeito_em IS NULL
          AND a.periodo_novo > date_trunc('month', p_data_inicio)::date
          AND a.competencia = date_trunc('month', p_data_inicio)::date
      )
    ),
    item_rows AS (
      SELECT
        bt.cliente_id,
        bt.cliente_nome,
        bt.contrato_id,
        bt.contrato_numero,
        bt.contrato_numero_sequencial,
        bt.nome_contrato,
        bt.caso_id,
        bt.caso_numero,
        bt.caso_nome,
        bt.origem_id,
        bt.data_referencia,
        bt.horas,
        bt.valor,
        bt.item_tipo,
        bt.caso_regra,
        bt.descricao,
        bt.valor_hora,
        bt.lancado_por
      FROM base_timesheet bt
      UNION ALL
      SELECT
        ri.cliente_id,
        ri.cliente_nome,
        ri.contrato_id,
        ri.contrato_numero,
        ri.contrato_numero_sequencial,
        ri.nome_contrato,
        ri.caso_id,
        ri.caso_numero,
        ri.caso_nome,
        ri.origem_id,
        ri.data_referencia,
        ri.horas,
        ri.valor,
        ri.item_tipo,
        NULL::text AS caso_regra,
        ri.descricao,
        ri.valor_hora,
        ri.lancado_por
      FROM regra_itens ri
    ),
    case_agg AS (
      SELECT
        cliente_id,
        cliente_nome,
        contrato_id,
        contrato_numero,
        contrato_numero_sequencial,
        nome_contrato,
        caso_id,
        caso_numero,
        caso_nome,
        -- Centro de custo do caso, para o filtro da barra superior (Filipe
        -- 07/08). Pega o primeiro do rateio, que e como o resto do sistema ja
        -- resolve quando precisa de um so.
        (SELECT COALESCE(ar.nome, NULLIF(rr->>'centro_custo_nome',''))
           FROM contracts.casos cs2
           CROSS JOIN LATERAL jsonb_array_elements(
             CASE WHEN jsonb_typeof(cs2.centro_custo_rateio)='array'
                  THEN cs2.centro_custo_rateio ELSE '[]'::jsonb END) rr
           LEFT JOIN people.areas ar ON ar.id = NULLIF(rr->>'centro_custo_id','')::uuid
          WHERE cs2.id = item_rows.caso_id
          LIMIT 1) AS centro_custo_nome,
        COUNT(*)::bigint AS total_itens,
        COALESCE(SUM(horas), 0)::numeric(12,2) AS total_horas,
        COALESCE(SUM(valor), 0)::numeric(14,2) AS total_valor,
        COALESCE(
          jsonb_agg(
            jsonb_build_object(
              -- origem_id faltava aqui: o front usa linha.origem_id para Postergar
              -- e Excluir (itens-a-faturar-list.tsx), e sem ele o filtro
              -- `Boolean(linha.origem_id)` nunca achava nada — os dois botoes
              -- ficavam sempre dizendo "sem lancamentos postergaveis/excluiveis".
              'origem_id', origem_id,
              'tipo', item_tipo,
              'caso_regra', caso_regra,
              'descricao', descricao,
              'valor_hora', valor_hora,
              'lancado_por', lancado_por,
              'data_referencia', data_referencia,
              'horas', horas,
              'valor', valor
            )
            -- regra do caso primeiro (valor principal), horas embaixo p/ validação
            ORDER BY (item_tipo = 'timesheet'), data_referencia NULLS LAST, descricao
          ),
          '[]'::jsonb
        ) AS extrato
      FROM item_rows
      GROUP BY cliente_id, cliente_nome, contrato_id, contrato_numero, contrato_numero_sequencial, nome_contrato, caso_id, caso_numero, caso_nome
    ),
    contrato_agg AS (
      SELECT
        cliente_id,
        cliente_nome,
        contrato_id,
        contrato_numero,
        contrato_numero_sequencial,
        nome_contrato,
        COALESCE(SUM(total_horas), 0)::numeric(12,2) AS total_horas,
        COALESCE(SUM(total_valor), 0)::numeric(14,2) AS total_valor,
        COALESCE(SUM(total_itens), 0)::bigint AS total_itens,
        jsonb_agg(
          jsonb_build_object(
            'caso_id', caso_id,
            'caso_numero', caso_numero,
            'caso_nome', caso_nome,
            'centro_custo_nome', centro_custo_nome,
            'total_horas', total_horas,
            'total_valor', total_valor,
            'total_itens', total_itens,
            'extrato', extrato
          )
          ORDER BY caso_numero NULLS LAST, caso_nome
        ) AS casos
      FROM case_agg
      GROUP BY cliente_id, cliente_nome, contrato_id, contrato_numero, contrato_numero_sequencial, nome_contrato
    ),
    cliente_agg AS (
      SELECT
        cliente_id,
        cliente_nome,
        COALESCE(SUM(total_horas), 0)::numeric(12,2) AS total_horas,
        COALESCE(SUM(total_valor), 0)::numeric(14,2) AS total_valor,
        COALESCE(SUM(total_itens), 0)::bigint AS total_itens,
        jsonb_agg(
          jsonb_build_object(
            'contrato_id', contrato_id,
            'contrato_numero', contrato_numero,
            'contrato_numero_sequencial', contrato_numero_sequencial,
            'contrato_nome', nome_contrato,
            'total_horas', total_horas,
            'total_valor', total_valor,
            'total_itens', total_itens,
            'casos', casos
          )
          ORDER BY contrato_numero NULLS LAST, nome_contrato
        ) AS contratos
      FROM contrato_agg
      GROUP BY cliente_id, cliente_nome
    )
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'cliente_id', cliente_id,
          'cliente_nome', cliente_nome,
          'total_horas', total_horas,
          'total_valor', total_valor,
          'total_itens', total_itens,
          'contratos', contratos
        )
        ORDER BY cliente_nome
      ),
      '[]'::jsonb
    )
    FROM cliente_agg
  );
END;
$function$;
