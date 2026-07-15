-- Rodada 3 do fluxo de revisão (feedback 15/07):
-- 1) Aba Horas ESTRITA: hora lançada só cai em 'hora' se o caso tem regra
--    de cobrança hora ativa; caso sem regra não cai em aba nenhuma.
-- 2) Fotos (foto_url) de quem envia/revisa/aprova para os avatares.
-- 3) Status 'ignorado': item sai da relação de cobrança (não vira nota,
--    não volta pra grid), timesheet segue existindo. Com justificativa.
-- 4) 'Enviar para faturamento': aprovado some da revisão só nesse gesto.

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


-- status 'ignorado' entra no vocabulário dos itens de faturamento
ALTER TABLE finance.billing_items DROP CONSTRAINT IF EXISTS billing_items_status_check;
ALTER TABLE finance.billing_items ADD CONSTRAINT billing_items_status_check
  CHECK (status::text = ANY (ARRAY['disponivel','em_revisao','em_aprovacao','aprovado','faturado','cancelado','ignorado']::text[]));

-- Ignorar a fatura: zera a cobrança; o timesheet segue existindo; o item sai
-- da relação de cobrança (status 'ignorado' não volta pra grid nem vira nota).
CREATE OR REPLACE FUNCTION public.ignorar_billing_items(p_ids uuid[], p_motivo text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_tenant_id uuid;
  v_count int := 0;
BEGIN
  SELECT tenant_id INTO v_tenant_id FROM core.tenant_users
  WHERE user_id = auth.uid() AND status = 'ativo' LIMIT 1;
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.get_user_permissions(auth.uid()) p
    WHERE p.permission_key IN ('finance.faturamento.review','finance.faturamento.approve','finance.faturamento.manage','finance.faturamento.*','finance.*','*')
  ) THEN
    RAISE EXCEPTION 'Sem permissão para ignorar itens da fatura';
  END IF;

  IF COALESCE(trim(p_motivo), '') = '' THEN
    RAISE EXCEPTION 'Informe a justificativa para ignorar a fatura';
  END IF;

  UPDATE finance.billing_items bi
  SET status = 'ignorado',
      valor_revisado = 0,
      valor_aprovado = 0,
      snapshot = COALESCE(bi.snapshot, '{}'::jsonb) || jsonb_build_object(
        'motivo_ignorado', trim(p_motivo),
        'ignorado_por', auth.uid(),
        'ignorado_em', now()
      ),
      updated_at = now(),
      updated_by = auth.uid()
  WHERE bi.tenant_id = v_tenant_id
    AND bi.id = ANY(p_ids)
    AND bi.status IN ('em_revisao', 'em_aprovacao');
  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object('ignorados', v_count);
END;
$function$;

-- Enviar para faturamento: o aprovado só some da revisão neste gesto
-- (pedido do Douglas — persistir até ele concluir em lote).
CREATE OR REPLACE FUNCTION public.marcar_enviado_faturamento(p_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_tenant_id uuid;
  v_count int := 0;
BEGIN
  SELECT tenant_id INTO v_tenant_id FROM core.tenant_users
  WHERE user_id = auth.uid() AND status = 'ativo' LIMIT 1;
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.get_user_permissions(auth.uid()) p
    WHERE p.permission_key IN ('finance.faturamento.approve','finance.faturamento.manage','finance.faturamento.*','finance.*','*')
  ) THEN
    RAISE EXCEPTION 'Sem permissão para enviar itens ao faturamento';
  END IF;

  UPDATE finance.billing_items bi
  SET snapshot = COALESCE(bi.snapshot, '{}'::jsonb) || jsonb_build_object(
        'enviado_faturamento', true,
        'enviado_faturamento_em', now(),
        'enviado_faturamento_por', auth.uid()
      ),
      updated_at = now(),
      updated_by = auth.uid()
  WHERE bi.tenant_id = v_tenant_id
    AND bi.id = ANY(p_ids)
    AND bi.status = 'aprovado';
  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object('enviados', v_count);
END;
$function$;

NOTIFY pgrst, 'reload schema';

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
          * COALESCE(
              NULLIF(
                CASE
                  WHEN jsonb_typeof(cs.regras_financeiras) = 'array' AND jsonb_array_length(cs.regras_financeiras) > 0
                    THEN cs.regras_financeiras->0->'regra_cobranca_config'->>'valor_hora'
                  ELSE cs.regra_cobranca_config->>'valor_hora'
                END,
                ''
              )::numeric,
              0
            )
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
        ('Timesheet - ' || to_char(t.data_lancamento::date, 'DD/MM/YYYY'))::text AS descricao
      FROM operations.timesheets t
      JOIN contracts.contratos c ON c.id = t.contrato_id AND c.tenant_id = v_tenant_id
      JOIN crm.clientes cli ON cli.id = c.cliente_id AND cli.tenant_id = v_tenant_id
      JOIN contracts.casos cs ON cs.id = t.caso_id AND cs.tenant_id = v_tenant_id
      WHERE t.tenant_id = v_tenant_id
        AND t.data_lancamento::date BETWEEN p_data_inicio AND p_data_fim
        AND c.status = 'ativo'
        AND cs.status <> 'inativo'
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
        CASE WHEN rs.regra_cobranca = 'salario_minimo' THEN 'mensalidade_processo' ELSE rs.regra_cobranca END AS item_tipo,
        (
          CASE
            WHEN rs.regra_cobranca IN ('mensalidade_processo', 'salario_minimo') THEN 'Mensalidade de processo'
            ELSE 'Mensalidade'
          END
          || ' - ' || to_char(gs.ref_mes, 'MM/YYYY')
        )::text AS descricao
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
            ELSE COALESCE(NULLIF(rs.cfg->>'valor_mensal', '')::numeric, 0)
          END
        ) AS valor
      ) val
      WHERE rs.rule_status = 'ativo'
        AND rs.regra_cobranca IN ('mensal', 'mensalidade_processo', 'salario_minimo')
        AND val.valor > 0
        AND (
          date_trunc('month', gs.ref_mes) <> date_trunc('month', CURRENT_DATE)
          OR COALESCE(rs.dia_inicio_faturamento, EXTRACT(DAY FROM rs.data_inicio_faturamento)::integer, 1)
            <= EXTRACT(DAY FROM CURRENT_DATE)::integer
        )
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
        ('Projeto - Parcela ' || p.ord::text)::text AS descricao
      FROM rules_source rs
      CROSS JOIN LATERAL jsonb_array_elements(rs.cfg->'parcelas') WITH ORDINALITY AS p(item, ord)
      WHERE rs.rule_status = 'ativo'
        AND rs.regra_cobranca = 'projeto'
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
        'Projeto - Valor único'::text AS descricao
      FROM rules_source rs
      WHERE rs.rule_status = 'ativo'
        AND rs.regra_cobranca = 'projeto'
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
        'Êxito'::text AS descricao
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
    regra_itens_raw AS (
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
        bt.descricao
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
        ri.descricao
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
        COUNT(*)::bigint AS total_itens,
        COALESCE(SUM(horas), 0)::numeric(12,2) AS total_horas,
        COALESCE(SUM(valor), 0)::numeric(14,2) AS total_valor,
        COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'tipo', item_tipo,
              'caso_regra', caso_regra,
              'descricao', descricao,
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
$function$
;

NOTIFY pgrst, 'reload schema';
