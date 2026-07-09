-- Revisão de fatura: escopo por centro de custo + revisor automático.
-- Regra do cliente:
--  * Diretor (centro de custo 'VLMA'/sem área) ou permissão de gestão -> vê tudo.
--  * Coordenador/sócio de área -> vê APENAS os itens do seu centro de custo
--    (itens de timesheet por área do autor; demais por centro_custo_rateio do caso).
--  * Quando revisores_modo='auto_centro_custo' e não há revisor manual, o revisor
--    exibido passa a ser o COORDENADOR da área do item (resolve o "Sem revisor definido").

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
      AND bi.status <> 'disponivel'
      AND (
        v_can_view_all
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

GRANT EXECUTE ON FUNCTION public.get_revisao_fatura(uuid, varchar, text, text, text, text) TO authenticated;
NOTIFY pgrst, 'reload schema';
