-- =====================================================================
-- Mensalidade de carteira cobrando por hora (pedido do cliente, out/2026).
--
-- Novo campo "Valor da hora" na regra mensalidade_carteira da MATRIZ, em
-- regra_cobranca_config.valor_hora_carteira (string decimal, "350.00").
-- Preenchido: toda hora dos casos da carteira — a matriz e os processos
-- ligados a ela por casos.parte_de_carteira_id — vale horas × esse valor, e
-- isso SOMA com a mensalidade da carteira (que continua saindo como hoje).
-- Vazio (ou zero): como sempre — a hora da carteira é registro de trabalho,
-- a R$ 0,00 (20260903230000_hora_em_caso_mensal_nao_cobra).
--
-- ONDE O CÁLCULO FICA: public.resolver_valor_hora, o único ponto que decide
-- valor/hora (20260731 — tabela de preço por cargo). Com isso a fila, o
-- gerador, a Revisão (itens da fila), postergados, gestão de horas, receita
-- prevista e o relatório de carteira enxergam o mesmo valor sem repetir a
-- conta. O valor sai da matriz por public.valor_hora_carteira (nova).
--   get_itens_a_faturar e start_faturamento_flow repetiam o "mensal sem
--   excedente = 0" do resolver num CASE próprio; o CASE sai (era idêntico ao
--   ramo do resolver) — sem isso a carteira continuaria a R$ 0,00 nos dois.
--   aplicar_teto_horas não age na carteira com valor da hora.
--
-- ITENS EXISTENTES (decisão do cliente: só novas horas):
--   * Na fila (timesheet sem item): passa a valer o valor da hora na hora.
--   * Já gerados — em revisão, em aprovação, aprovados, faturados: ficam com
--     o valor com que nasceram. Os dois gatilhos de recálculo por troca de
--     regra (trg_caso_regra_recalcula_itens e recalcular_aprovados_apos_regra)
--     não agem quando o caso era carteira e continua carteira; e a Revisão
--     (get_revisao_fatura) devolve, para item de carteira, o valor/hora do
--     próprio item como "vigente" — senão a tela reprecificava as pendentes
--     e o OK do revisor gravava. Quem quiser cobrar uma hora já gerada edita
--     o valor na Revisão, como em qualquer item.
--   * Virar carteira (ou deixar de ser) continua recalculando as pendentes
--     como qualquer troca de regra.
--
-- Fonte das funções: produção (pg_get_functiondef, 26/10/2026). Assinaturas
-- mantidas.
-- =====================================================================

-- 1. Helpers.

-- Regra efetiva do caso, como resolver_valor_hora e aplicar_teto_horas leem:
-- a da primeira regra de regras_financeiras, senão casos.regra_cobranca.
CREATE OR REPLACE FUNCTION public.regra_efetiva_caso(p_regras_financeiras jsonb, p_regra_cobranca text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT COALESCE(
    NULLIF(
      CASE WHEN jsonb_typeof(p_regras_financeiras) = 'array'
           THEN p_regras_financeiras->0->>'regra_cobranca' END,
      ''),
    p_regra_cobranca,
    '');
$function$;

-- "Valor da hora" da carteira do caso: o da regra mensalidade_carteira da
-- MATRIZ (o próprio caso, ou casos.parte_de_carteira_id para um processo).
-- NULL quando o caso não é de carteira ou o valor está vazio, zero ou não é
-- número — nesse caso tudo segue como antes (hora a R$ 0,00).
CREATE OR REPLACE FUNCTION public.valor_hora_carteira(p_caso_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE
AS $function$
  SELECT CASE
    WHEN x.v ~ '^[0-9]+(\.[0-9]+)?$' AND x.v::numeric > 0 THEN round(x.v::numeric, 2)
  END
  FROM (
    SELECT btrim(COALESCE(
      -- a regra de carteira da matriz (ativa primeiro)...
      (SELECT r->'regra_cobranca_config'->>'valor_hora_carteira'
         FROM jsonb_array_elements(
                CASE WHEN jsonb_typeof(m.regras_financeiras) = 'array'
                     THEN m.regras_financeiras ELSE '[]'::jsonb END
              ) WITH ORDINALITY AS e(r, ord)
        WHERE r->>'regra_cobranca' = 'mensalidade_carteira'
          AND NULLIF(btrim(r->'regra_cobranca_config'->>'valor_hora_carteira'), '') IS NOT NULL
        ORDER BY (COALESCE(NULLIF(r->>'status', ''), 'ativo') = 'ativo') DESC, ord
        LIMIT 1),
      -- ...ou a config espelhada no caso (caso antigo, sem regras_financeiras)
      m.regra_cobranca_config->>'valor_hora_carteira',
      '')) AS v
    FROM contracts.casos cs
    JOIN contracts.casos m ON m.id = COALESCE(cs.parte_de_carteira_id, cs.id)
    WHERE cs.id = p_caso_id
      AND public.regra_efetiva_caso(cs.regras_financeiras, cs.regra_cobranca) = 'mensalidade_carteira'
      AND public.regra_efetiva_caso(m.regras_financeiras, m.regra_cobranca) = 'mensalidade_carteira'
  ) x;
$function$;

REVOKE ALL ON FUNCTION public.regra_efetiva_caso(jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.regra_efetiva_caso(jsonb, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.valor_hora_carteira(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.valor_hora_carteira(uuid) TO authenticated, service_role;

-- 2. Único ponto de cálculo do valor/hora.
CREATE OR REPLACE FUNCTION public.resolver_valor_hora(p_caso_id uuid, p_cargo_id uuid DEFAULT NULL::uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE
AS $function$
  WITH r AS (
    SELECT
      CASE
        WHEN jsonb_typeof(cs.regras_financeiras) = 'array'
             AND jsonb_array_length(cs.regras_financeiras) > 0
          THEN cs.regras_financeiras->0
        ELSE NULL
      END AS x,
      cs.regra_cobranca,
      cs.regra_cobranca_config
    FROM contracts.casos cs
    WHERE cs.id = p_caso_id
  ),
  cfg AS (
    SELECT
      COALESCE(NULLIF(r.x->>'regra_cobranca', ''), r.regra_cobranca, '') AS regra,
      COALESCE(r.x->'regra_cobranca_config', r.regra_cobranca_config, '{}'::jsonb) AS c
    FROM r
  )
  SELECT CASE
    -- Mensalidade de carteira com "Valor da hora" na matriz (out/2026): toda
    -- hora da carteira — matriz e processos — vale esse valor e soma com a
    -- mensalidade. Vem antes do teto e do "mensal = 0": é o combinado da
    -- carteira, e vale igual para qualquer cargo. Vazio = NULL aqui, e segue
    -- como antes (R$ 0,00).
    WHEN (SELECT regra FROM cfg) = 'mensalidade_carteira'
     AND public.valor_hora_carteira(p_caso_id) IS NOT NULL
    THEN public.valor_hora_carteira(p_caso_id)
    -- Mensalidade com teto de horas e excedente: o preco por hora nao e
    -- por linha, e do periodo (finance.aplicar_teto_horas). NULL = mantem
    -- o valor gravado.
    WHEN (SELECT regra FROM cfg) IN ('mensal', 'mensalidade_processo', 'mensalidade_carteira', 'salario_minimo')
     AND COALESCE(((SELECT c FROM cfg)->>'cobra_excedente')::boolean, false)
     AND COALESCE(((SELECT c FROM cfg)->>'cap_enabled')::boolean, false)
     AND COALESCE(NULLIF((SELECT c FROM cfg)->>'cap_max', '')::numeric, 0) > 0
    THEN NULL
    -- Regra mensal sem excedente: a hora e registro de trabalho, nao cobranca.
    WHEN (SELECT regra FROM cfg) IN ('mensal', 'mensalidade_processo', 'mensalidade_carteira', 'salario_minimo')
     AND COALESCE(((SELECT c FROM cfg)->>'cobra_excedente')::boolean, false) = false
    THEN 0
    ELSE COALESCE(
      (
        SELECT NULLIF(i->>'valor_hora', '')::numeric
        FROM cfg, LATERAL jsonb_array_elements(
               CASE WHEN jsonb_typeof(cfg.c->'tabela_preco_itens') = 'array'
                    THEN cfg.c->'tabela_preco_itens' ELSE '[]'::jsonb END
             ) i
        WHERE p_cargo_id IS NOT NULL
          AND i->>'cargo_id' = p_cargo_id::text
          AND COALESCE(NULLIF(i->>'valor_hora', '')::numeric, 0) > 0
        LIMIT 1
      ),
      (SELECT NULLIF(cfg.c->>'valor_hora', '')::numeric FROM cfg)
    )
  END;
$function$;

-- 3. Fila: o valor da hora vem só do resolver.
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
          -- Caso com regra MENSAL (ou mensalidade de processo / carteira /
          -- salario minimo) ja cobra pelo periodo: a hora entra pelo registro,
          -- valendo zero. Antes ela era valorizada pela tabela de preco mesmo
          -- assim, e o caso cobrava as duas coisas — Filipe, 03/09, caso 319:
          -- mensalidade de R$ 25.000 somando com R$ 116.921,80 de horas.
          --
          -- 'cobra_excedente' = true e a excecao deliberada: o combinado inclui
          -- N horas e o que passar disso se cobra. Ai a hora volta a valer.
          --
          -- Essa regra mora em resolver_valor_hora (devolve 0 nesse caso).
          -- A fila repetia a conta aqui e, com isso, a carteira com "Valor da
          -- hora" (out/2026) continuaria a R$ 0,00 — agora vale só o resolver.
          COALESCE(t.horas, 0) * COALESCE(public.resolver_valor_hora(cs.id, t.cargo_id), 0)
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
        COALESCE(aut.nome, '')::text AS lancado_por
      FROM operations.timesheets t
      LEFT JOIN people.colaboradores aut ON aut.user_id = t.created_by AND aut.tenant_id = v_tenant_id
      JOIN contracts.contratos c ON c.id = t.contrato_id AND c.tenant_id = v_tenant_id
      JOIN crm.clientes cli ON cli.id = c.cliente_id AND cli.tenant_id = v_tenant_id
      JOIN contracts.casos cs ON cs.id = t.caso_id AND cs.tenant_id = v_tenant_id
      -- Regra vigente do caso, para saber se a hora e cobravel. Precisa vir
      -- DEPOIS do join de casos: LATERAL so enxerga o que ja esta no FROM.
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
      WHERE t.tenant_id = v_tenant_id
        -- Periodo efetivo: data do trabalho, a menos que tenha sido postergado
        -- para outro mes (postergar_timesheet) — ai vale a data escolhida.
        AND COALESCE(t.periodo_faturamento, t.data_lancamento::date) BETWEEN p_data_inicio AND p_data_fim
        AND c.status = 'ativo'
        AND cs.status <> 'inativo'
        AND NOT t.excluido_faturamento
        AND t.apagado_em IS NULL
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

-- 4. Gerador: o valor da hora vem só do resolver (igual à fila).
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
  v_auto_count int := 0;
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
      AND t.apagado_em IS NULL
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
      -- O "mensal sem excedente = 0" mora em resolver_valor_hora; repetir
      -- aqui deixaria a carteira com "Valor da hora" (out/2026) a R$ 0,00.
      COALESCE(public.resolver_valor_hora(cs.id, t.cargo_id), 0) AS valor_hora,
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
      -- Hora de processo de carteira nunca era gerada (valia 0 e a cobrança
      -- é a mensalidade da matriz). Com "Valor da hora" na carteira (out/2026)
      -- ela é cobrada: passa a ser gerada, no caso do próprio processo. Sem
      -- valor, segue como antes (fica fora do gerador).
      AND (cs.parte_de_carteira_id IS NULL OR public.valor_hora_carteira(cs.id) IS NOT NULL)
      AND (
        v_alvo_tipo = 'itens'
        OR (v_alvo_tipo = 'cliente' AND cli.id = ANY(v_alvo_ids))
        OR (v_alvo_tipo = 'contrato' AND c.id = ANY(v_alvo_ids))
        OR (v_alvo_tipo = 'caso' AND cs.id = ANY(v_alvo_ids))
      )
      -- 28/09: só as horas marcadas na fila
      AND (NOT v_filtra_itens OR t.id = ANY(v_sel_ts))
      -- Lixeira: hora apagada ou excluída da fila não é gerada (antes o
      -- gerador não lia excluido_faturamento).
      AND t.apagado_em IS NULL
      AND NOT COALESCE(t.excluido_faturamento, false)
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

  -- 18/10: aprovação automática dos itens de regra projeto (sem parcelas).
  -- Só age com a chave do tenant ligada (finance.autoaprovacao_projeto_ligada,
  -- core.system_settings 'faturamento.autoaprovar_projeto'); desligada devolve
  -- 0 e o lote sai exatamente como antes — tudo em_revisao.
  IF v_batch_id IS NOT NULL THEN
    v_auto_count := finance.auto_aprovar_itens_projeto(p_user_id, v_tenant_id, v_batch_id);
  END IF;

  RETURN jsonb_build_object(
    'batch_id', v_batch_id,
    'batch_numero', v_batch_numero,
    'itens_criados', v_items_count
  ) || CASE WHEN v_auto_count > 0
            THEN jsonb_build_object('itens_autoaprovados', v_auto_count)
            ELSE '{}'::jsonb END;
END;
$function$;

-- 5. Teto de horas não se aplica à carteira com valor da hora.
CREATE OR REPLACE FUNCTION finance.aplicar_teto_horas(p_caso_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'finance', 'contracts', 'public'
AS $function$
DECLARE
  v_regra text;
  v_cfg jsonb;
  v_cap numeric;
  v_vh_exc numeric;
  v_n integer := 0;
BEGIN
  SELECT
    COALESCE(NULLIF(cs.regras_financeiras->0->>'regra_cobranca', ''), cs.regra_cobranca, ''),
    COALESCE(cs.regras_financeiras->0->'regra_cobranca_config', cs.regra_cobranca_config, '{}'::jsonb)
    INTO v_regra, v_cfg
  FROM contracts.casos cs WHERE cs.id = p_caso_id;

  IF v_regra IS NULL
     OR v_regra NOT IN ('mensal', 'mensalidade_processo', 'mensalidade_carteira', 'salario_minimo')
     OR NOT COALESCE((v_cfg->>'cobra_excedente')::boolean, false)
     OR NOT COALESCE((v_cfg->>'cap_enabled')::boolean, false)
  THEN
    RETURN 0;
  END IF;

  -- Carteira com "Valor da hora" (out/2026): toda hora é cobrada pelo valor
  -- da carteira (resolver_valor_hora); não há teto a aplicar por cima.
  IF v_regra = 'mensalidade_carteira' AND public.valor_hora_carteira(p_caso_id) IS NOT NULL THEN
    RETURN 0;
  END IF;

  v_cap := COALESCE(NULLIF(v_cfg->>'cap_max', '')::numeric, 0);
  -- Sem valor de excedente cadastrado, cai no valor/hora do caso.
  v_vh_exc := COALESCE(NULLIF(v_cfg->>'valor_hora_excedente', '')::numeric,
                       NULLIF(v_cfg->>'valor_hora', '')::numeric, 0);
  IF v_cap <= 0 THEN RETURN 0; END IF;

  -- Horas acumuladas por periodo, em ordem de data; o que passa do teto e
  -- cobrado pela parte que passa.
  WITH itens AS (
    SELECT bi.id, bi.periodo_inicio, bi.periodo_fim,
           COALESCE(bi.horas_aprovadas, bi.horas_revisadas, bi.horas_informadas, 0) AS horas,
           SUM(COALESCE(bi.horas_aprovadas, bi.horas_revisadas, bi.horas_informadas, 0))
             OVER (PARTITION BY bi.periodo_inicio, bi.periodo_fim
                   ORDER BY bi.data_referencia, bi.created_at, bi.id
                   ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS acumulado
    FROM finance.billing_items bi
    WHERE bi.caso_id = p_caso_id
      AND bi.origem_tipo = 'timesheet'
      AND bi.status IN ('em_revisao', 'em_aprovacao', 'aprovado')
  ),
  calc AS (
    SELECT id, horas,
           GREATEST(0, LEAST(horas, acumulado - v_cap)) AS horas_excedentes
    FROM itens
  )
  UPDATE finance.billing_items bi
     SET valor_informado = ROUND(c.horas_excedentes * v_vh_exc, 2),
         valor_revisado  = CASE WHEN bi.horas_revisadas IS NULL THEN bi.valor_revisado
                                ELSE ROUND(c.horas_excedentes * v_vh_exc, 2) END,
         valor_aprovado  = CASE WHEN bi.horas_aprovadas IS NULL THEN bi.valor_aprovado
                                ELSE ROUND(c.horas_excedentes * v_vh_exc, 2) END,
         -- valor_hora efetivo da linha: 0 dentro do teto, excedente fora.
         snapshot = jsonb_set(
           COALESCE(bi.snapshot, '{}'::jsonb), '{valor_hora}',
           to_jsonb(CASE WHEN c.horas_excedentes > 0 THEN v_vh_exc ELSE 0 END)),
         updated_at = now()
    FROM calc c
   WHERE bi.id = c.id
     AND (
       COALESCE(bi.valor_aprovado, bi.valor_revisado, bi.valor_informado, 0)
         <> ROUND(c.horas_excedentes * v_vh_exc, 2)
       OR COALESCE(NULLIF(bi.snapshot->>'valor_hora', '')::numeric, -1)
         <> CASE WHEN c.horas_excedentes > 0 THEN v_vh_exc ELSE 0 END
     );
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $function$;

-- 6. Mudança na carteira não reprecifica itens já gerados.
CREATE OR REPLACE FUNCTION contracts.trg_caso_regra_recalcula_itens()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'contracts', 'finance', 'public'
AS $function$
BEGIN
  -- Carteira que continua carteira (mudou o valor da hora, a mensalidade, os
  -- processos...): itens já gerados NÃO são reprecificados (cliente, out/2026:
  -- o valor da hora vale para as horas que ainda vão ser geradas). Antes
  -- desta migration a hora da carteira valia sempre 0, então o recálculo aqui
  -- não mudava nada; agora mudaria. Virar carteira ou deixar de ser segue
  -- recalculando, como em qualquer troca de regra.
  IF public.regra_efetiva_caso(OLD.regras_financeiras, OLD.regra_cobranca) = 'mensalidade_carteira'
     AND public.regra_efetiva_caso(NEW.regras_financeiras, NEW.regra_cobranca) = 'mensalidade_carteira' THEN
    RETURN NEW;
  END IF;
  PERFORM finance.recalcular_valores_hora_do_caso(NEW.id);
  PERFORM finance.aplicar_teto_horas(NEW.id);
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION contracts.recalcular_aprovados_apos_regra()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_row record;
BEGIN
  -- Carteira que continua carteira: aprovado já gerado não é reprecificado
  -- (mesmo critério de contracts.trg_caso_regra_recalcula_itens, out/2026).
  IF public.regra_efetiva_caso(OLD.regras_financeiras, OLD.regra_cobranca) = 'mensalidade_carteira'
     AND public.regra_efetiva_caso(NEW.regras_financeiras, NEW.regra_cobranca) = 'mensalidade_carteira' THEN
    RETURN NEW;
  END IF;

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
$function$;

-- 7. Revisão: item de carteira já gerado mantém o valor/hora dele.
CREATE OR REPLACE FUNCTION public.get_revisao_fatura(p_user_id uuid, p_status character varying DEFAULT NULL::character varying, p_lote text DEFAULT NULL::text, p_cliente text DEFAULT NULL::text, p_contrato text DEFAULT NULL::text, p_caso text DEFAULT NULL::text, p_competencia date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_tenant_id uuid;
  v_can_read boolean := false;
  v_can_view_all boolean := false;
  v_viewer_area_id uuid;
  v_competencia date;
BEGIN
  -- Tenant + regra de visibilidade (vê tudo / escopo por centro de custo)
  -- agora vivem em finance.escopo_faturamento, compartilhada com a fila
  -- (get_fila_por_competencia). Mesma regra nos dois lugares, por construção.
  SELECT e.tenant_id, e.can_view_all, e.viewer_area_id
  INTO v_tenant_id, v_can_view_all, v_viewer_area_id
  FROM finance.escopo_faturamento(p_user_id) e;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não associado a tenant';
  END IF;

  v_competencia := date_trunc('month', p_competencia)::date;

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

  RETURN (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'billing_item_id', bi.id,
          'item_numero', bi.numero,
          'billing_batch_id', bi.billing_batch_id,
          'batch_numero', b.numero,
          'status', bi.status,
          'grupo_id', bi.grupo_id,
          'origem_tipo', bi.origem_tipo,
          'origem_id', bi.origem_id,
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
        -- Campos do grupo por fora: o objeto acima ja esta no teto de 100
        -- argumentos do jsonb_build_object.
        || jsonb_build_object(
          'contrato_numero_sequencial', COALESCE(c.numero_sequencial, c.numero),
          'grupo_texto', gr.texto,
          'grupo_horas', gr.horas_revisadas,
          'grupo_valor', gr.valor_revisado,
          -- Centro de custo do item, para o filtro da barra superior (Filipe
          -- 07/08). Reusa ia.area_id, que ja era calculado para as regras de
          -- visibilidade: timesheet usa a area do autor; os demais, o primeiro
          -- centro de custo do rateio do caso.
          'centro_custo_nome', ar_item.nome,
          -- Competência = mês de faturamento do item (periodo_inicio gravado
          -- ao liberar; item antigo sem período cai na data de criação).
          -- A tela agrupa as abas por isto.
          'periodo_inicio', bi.periodo_inicio,
          'periodo_fim', bi.periodo_fim,
          'competencia', date_trunc('month', COALESCE(bi.periodo_inicio, bi.created_at::date))::date
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
      --
      -- Carteira (out/2026): o item já gerado fica com o valor/hora com que
      -- nasceu (snapshot.valor_hora — o gerador grava; o recálculo de troca
      -- de regra atualiza). Preencher ou mudar o "Valor da hora" da carteira
      -- vale para as horas que ainda vão ser geradas; sem isto, a tela
      -- reprecificaria na hora as pendentes (o front usa este valor para
      -- itens em revisão/aprovação) e o OK do revisor gravaria.
      SELECT CASE
        WHEN bi.origem_tipo = 'timesheet'
         AND public.regra_efetiva_caso(cs.regras_financeiras, cs.regra_cobranca) = 'mensalidade_carteira'
         AND COALESCE(bi.snapshot->>'valor_hora', '') ~ '^[0-9]+(\.[0-9]+)?$'
        THEN (bi.snapshot->>'valor_hora')::numeric
        ELSE public.resolver_valor_hora(cs.id, ts_cargo.cargo_id)
      END AS valor_hora_atual
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
      SELECT co.nome, co.foto_url, co.user_id
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
    LEFT JOIN LATERAL (
      SELECT g.texto, g.horas_revisadas, g.valor_revisado
      FROM finance.billing_item_grupos g
      WHERE g.grupo_id = bi.grupo_id AND g.tenant_id = bi.tenant_id
    ) gr ON true
    LEFT JOIN people.areas ar_item ON ar_item.id = ia.area_id AND ar_item.tenant_id = bi.tenant_id
    WHERE bi.tenant_id = v_tenant_id
      AND bi.status NOT IN ('disponivel', 'cancelado', 'ignorado')
      AND (
        v_can_view_all
        -- responsável reatribuído da etapa vê o item mesmo de outro CC
        OR bi.responsavel_revisao_id = p_user_id
        OR bi.responsavel_aprovacao_id = p_user_id
        -- Revisor/aprovador CONFIGURADO no caso (timesheet_config) ou revisor
        -- automático por centro de custo: vê o item mesmo que o autor seja de
        -- outra área. Bruna Fedatto (Contratos) não via 12 itens de outubro em
        -- que era a revisora, lançados por gente do Tributário e do Contencioso
        -- (Filipe, 06/10). Vale para 7 revisores que não são sócios.
        OR rev_colab.user_id = p_user_id
        OR apr_colab.user_id = p_user_id
        OR auto_rev.user_id = p_user_id
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
      -- Sem p_competencia: comportamento de sempre (todos os meses). A
      -- Composição e o fluxo antigo dependem disso.
      AND (
        v_competencia IS NULL
        OR date_trunc('month', COALESCE(bi.periodo_inicio, bi.created_at::date))::date = v_competencia
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
$function$;

NOTIFY pgrst, 'reload schema';
