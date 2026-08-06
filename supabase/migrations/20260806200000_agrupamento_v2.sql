-- Agrupamento de lancamentos, versao 2 (respostas do Filipe em 06/08).
--
-- Antes, agrupar so marcava os itens com um grupo_id e eles continuavam
-- aparecendo separados. Agora o grupo tem existencia propria: um texto que o
-- revisor escreve, e horas/valor que ele pode ajustar.
--
-- Decisoes do cliente, registradas aqui porque mudam o comportamento:
--   . aprovar o grupo aprova todos os itens de uma vez
--   . desagrupar devolve cada item ao estado original — o texto fundido e
--     descartado, e por isso ele mora no grupo e nao nos itens
--   . o texto fundido nasce da juncao dos textos, mas e livre para edicao
--   . pode agrupar lancamentos de pessoas diferentes

CREATE TABLE IF NOT EXISTS finance.billing_item_grupos (
  grupo_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  caso_id uuid,
  texto text,
  horas_revisadas numeric(12,2),
  valor_revisado numeric(14,2),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

CREATE INDEX IF NOT EXISTS billing_item_grupos_tenant_idx
  ON finance.billing_item_grupos (tenant_id);

-- agrupar: alem de marcar os itens, cria o grupo ja com o texto juntado e os
-- totais somados, que e o ponto de partida para o revisor editar.
CREATE OR REPLACE FUNCTION public.agrupar_billing_items(p_user_id uuid, p_item_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'finance', 'core'
AS $function$
DECLARE
  v_tenant_id uuid;
  v_grupo uuid := gen_random_uuid();
  v_casos int;
  v_total int;
  v_bloqueados int;
  v_caso uuid;
  v_texto text;
  v_horas numeric(12,2);
  v_valor numeric(14,2);
BEGIN
  p_user_id := COALESCE(auth.uid(), p_user_id);

  SELECT tu.tenant_id INTO v_tenant_id
  FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id AND tu.status = 'ativo' LIMIT 1;
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.get_user_permissions(p_user_id) p
    WHERE p.permission_key IN ('finance.faturamento.review','finance.faturamento.approve',
                               'finance.faturamento.manage','finance.faturamento.*','finance.*','*')
  ) THEN
    RAISE EXCEPTION 'Sem permissão para agrupar lançamentos';
  END IF;

  IF COALESCE(array_length(p_item_ids, 1), 0) < 2 THEN
    RAISE EXCEPTION 'Selecione ao menos dois lançamentos para agrupar.';
  END IF;

  SELECT count(*), count(DISTINCT caso_id), (array_agg(caso_id))[1],
         count(*) FILTER (WHERE status NOT IN ('em_revisao','em_aprovacao') OR grupo_id IS NOT NULL)
    INTO v_total, v_casos, v_caso, v_bloqueados
  FROM finance.billing_items
  WHERE id = ANY(p_item_ids) AND tenant_id = v_tenant_id AND origem_tipo = 'timesheet';

  IF v_total <> array_length(p_item_ids, 1) THEN
    RAISE EXCEPTION 'Só é possível agrupar lançamentos de horas ainda em revisão.';
  END IF;
  IF v_casos > 1 THEN
    RAISE EXCEPTION 'Só dá para agrupar lançamentos do mesmo caso.';
  END IF;
  IF v_bloqueados > 0 THEN
    RAISE EXCEPTION 'Um ou mais lançamentos já foram aprovados ou já estão em outro grupo. Devolva para revisão antes de agrupar.';
  END IF;

  -- Texto de partida: os textos dos lancamentos, na ordem da data, sem repetir
  -- os iguais (lancamentos de template costumam repetir a mesma frase).
  SELECT string_agg(t, E'\n') INTO v_texto FROM (
    SELECT DISTINCT ON (t) t, min(ordem) AS ordem FROM (
      SELECT COALESCE(
               NULLIF(trim(bi.snapshot->>'timesheet_descricao'), ''),
               NULLIF(trim(bi.snapshot->>'descricao'), '')
             ) AS t,
             row_number() OVER (ORDER BY bi.data_referencia, bi.created_at) AS ordem
      FROM finance.billing_items bi
      WHERE bi.id = ANY(p_item_ids) AND bi.tenant_id = v_tenant_id
    ) x WHERE t IS NOT NULL GROUP BY t
  ) y;

  -- Horas somam. Valor tambem SOMA os valores individuais, e nao recalcula por
  -- um preco/hora unico: pessoas de cargos diferentes tem preco diferente, e
  -- multiplicar as horas somadas por um preco so mudaria o valor da fatura.
  SELECT COALESCE(sum(COALESCE(horas_revisadas, horas_informadas, 0)), 0),
         COALESCE(sum(COALESCE(valor_revisado, valor_informado, 0)), 0)
    INTO v_horas, v_valor
  FROM finance.billing_items
  WHERE id = ANY(p_item_ids) AND tenant_id = v_tenant_id;

  INSERT INTO finance.billing_item_grupos
    (grupo_id, tenant_id, caso_id, texto, horas_revisadas, valor_revisado, created_by, updated_by)
  VALUES (v_grupo, v_tenant_id, v_caso, v_texto, v_horas, v_valor, p_user_id, p_user_id);

  UPDATE finance.billing_items
  SET grupo_id = v_grupo, updated_at = now(), updated_by = p_user_id
  WHERE id = ANY(p_item_ids) AND tenant_id = v_tenant_id;

  RETURN jsonb_build_object('grupo_id', v_grupo, 'itens', v_total,
                            'texto', v_texto, 'horas', v_horas, 'valor', v_valor);
END;
$function$;

-- desagrupar: apaga o grupo junto. O texto fundido some de proposito — cada
-- lancamento volta ao texto original dele, que nunca foi tocado.
CREATE OR REPLACE FUNCTION public.desagrupar_billing_items(p_user_id uuid, p_grupo_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'finance', 'core'
AS $function$
DECLARE
  v_tenant_id uuid;
  v_aprovados int;
  v_afetados int;
BEGIN
  p_user_id := COALESCE(auth.uid(), p_user_id);

  SELECT tu.tenant_id INTO v_tenant_id
  FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id AND tu.status = 'ativo' LIMIT 1;
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.get_user_permissions(p_user_id) p
    WHERE p.permission_key IN ('finance.faturamento.review','finance.faturamento.approve',
                               'finance.faturamento.manage','finance.faturamento.*','finance.*','*')
  ) THEN
    RAISE EXCEPTION 'Sem permissão para desagrupar lançamentos';
  END IF;

  SELECT count(*) FILTER (WHERE status = 'aprovado') INTO v_aprovados
  FROM finance.billing_items
  WHERE grupo_id = p_grupo_id AND tenant_id = v_tenant_id;

  IF v_aprovados > 0 THEN
    RAISE EXCEPTION 'Este grupo já foi aprovado. Devolva para revisão antes de desagrupar.';
  END IF;

  UPDATE finance.billing_items
  SET grupo_id = NULL, updated_at = now(), updated_by = p_user_id
  WHERE grupo_id = p_grupo_id AND tenant_id = v_tenant_id;
  GET DIAGNOSTICS v_afetados = ROW_COUNT;

  DELETE FROM finance.billing_item_grupos
   WHERE grupo_id = p_grupo_id AND tenant_id = v_tenant_id;

  RETURN jsonb_build_object('itens', v_afetados);
END;
$function$;

-- O revisor edita o texto fundido e, se quiser, arredonda as horas do grupo.
CREATE OR REPLACE FUNCTION public.atualizar_grupo_billing_items(
  p_user_id uuid, p_grupo_id uuid, p_payload jsonb
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'finance', 'core'
AS $function$
DECLARE
  v_tenant_id uuid;
  v_aprovados int;
BEGIN
  p_user_id := COALESCE(auth.uid(), p_user_id);

  SELECT tu.tenant_id INTO v_tenant_id
  FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id AND tu.status = 'ativo' LIMIT 1;
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.get_user_permissions(p_user_id) p
    WHERE p.permission_key IN ('finance.faturamento.review','finance.faturamento.approve',
                               'finance.faturamento.manage','finance.faturamento.*','finance.*','*')
  ) THEN
    RAISE EXCEPTION 'Sem permissão para editar o grupo';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM finance.billing_item_grupos WHERE grupo_id = p_grupo_id AND tenant_id = v_tenant_id) THEN
    RAISE EXCEPTION 'Grupo não encontrado';
  END IF;

  SELECT count(*) FILTER (WHERE status = 'aprovado') INTO v_aprovados
  FROM finance.billing_items WHERE grupo_id = p_grupo_id AND tenant_id = v_tenant_id;
  IF v_aprovados > 0 THEN
    RAISE EXCEPTION 'Este grupo já foi aprovado. Devolva para revisão antes de editar.';
  END IF;

  IF p_payload ? 'horas' AND COALESCE(NULLIF(replace(p_payload->>'horas', ',', '.'), '')::numeric, 0) < 0 THEN
    RAISE EXCEPTION 'Horas inválidas';
  END IF;

  UPDATE finance.billing_item_grupos SET
    texto = CASE WHEN p_payload ? 'texto' THEN NULLIF(trim(p_payload->>'texto'), '') ELSE texto END,
    horas_revisadas = CASE WHEN p_payload ? 'horas'
      THEN COALESCE(NULLIF(replace(p_payload->>'horas', ',', '.'), '')::numeric, 0) ELSE horas_revisadas END,
    valor_revisado = CASE WHEN p_payload ? 'valor'
      THEN COALESCE(NULLIF(replace(p_payload->>'valor', ',', '.'), '')::numeric, 0) ELSE valor_revisado END,
    updated_at = now(), updated_by = p_user_id
  WHERE grupo_id = p_grupo_id AND tenant_id = v_tenant_id;

  RETURN jsonb_build_object('grupo_id', p_grupo_id);
END;
$function$;
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
          'grupo_id', bi.grupo_id,
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
        -- Campos do grupo por fora: o objeto acima ja esta no teto de 100
        -- argumentos do jsonb_build_object.
        || jsonb_build_object(
          'grupo_texto', gr.texto,
          'grupo_horas', gr.horas_revisadas,
          'grupo_valor', gr.valor_revisado
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
    LEFT JOIN LATERAL (
      SELECT g.texto, g.horas_revisadas, g.valor_revisado
      FROM finance.billing_item_grupos g
      WHERE g.grupo_id = bi.grupo_id AND g.tenant_id = bi.tenant_id
    ) gr ON true
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
$function$;
