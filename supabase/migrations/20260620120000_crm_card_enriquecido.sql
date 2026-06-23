-- CRM: card enriquecido.
-- Temperatura passa a ser percentual (0-100, barra). Segmento econômico e
-- cidade refletem o cadastro do cliente (não duplicam dado).

ALTER TABLE crm.pipeline_cards ADD COLUMN IF NOT EXISTS temperatura_pct smallint
  CHECK (temperatura_pct IS NULL OR (temperatura_pct >= 0 AND temperatura_pct <= 100));

-- ── get_crm_pipeline_cards: + temperatura_pct, segmento, cidade/uf do cliente ─
CREATE OR REPLACE FUNCTION public.get_crm_pipeline_cards(p_user_id uuid)
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

  RETURN COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', c.id,
        'cliente_id', c.cliente_id,
        'cliente_nome', cli.nome,
        'segmento_nome', (
          SELECT string_agg(seg.nome, ', ' ORDER BY seg.nome)
          FROM crm.clientes_segmentos cs
          JOIN crm.segmentos_economicos seg ON seg.id = cs.segmento_id
          WHERE cs.cliente_id = c.cliente_id
        ),
        'cidade', cli.cidade,
        'estado', cli.estado,
        'servico_id', c.servico_id,
        'servico_nome', srv.nome,
        'produto_id', c.produto_id,
        'produto_nome', prod.nome,
        'valor', COALESCE(c.valor, 0),
        'responsavel_interno_id', c.responsavel_interno_id,
        'responsavel_interno_nome', col.nome,
        'temperatura_pct', c.temperatura_pct,
        'area_id', c.area_id,
        'observacoes', c.observacoes,
        'etapa', c.etapa,
        'ordem', c.ordem,
        'ativo', c.ativo,
        'converted_solicitacao_id', c.converted_solicitacao_id,
        'created_at', c.created_at,
        'updated_at', c.updated_at,
        'anexos', COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', a.id, 'nome', a.nome, 'arquivo_nome', a.arquivo_nome,
              'mime_type', a.mime_type, 'tamanho_bytes', a.tamanho_bytes, 'created_at', a.created_at
            ) ORDER BY a.created_at DESC
          )
          FROM crm.pipeline_card_anexos a WHERE a.card_id = c.id
        ), '[]'::jsonb)
      )
      ORDER BY
        CASE c.etapa
          WHEN 'prospeccao' THEN 1 WHEN 'proposta_solicitada' THEN 2
          WHEN 'proposta_enviada' THEN 3 WHEN 'conversao' THEN 4
          WHEN 'negada' THEN 5 WHEN 'suspensa' THEN 6 ELSE 99
        END,
        c.ordem ASC, c.created_at DESC
    )
    FROM crm.pipeline_cards c
    JOIN crm.clientes cli ON cli.id = c.cliente_id
    LEFT JOIN operations.categorias_servico srv ON srv.id = c.servico_id
    LEFT JOIN contracts.produtos prod ON prod.id = c.produto_id
    LEFT JOIN people.colaboradores col ON col.id = c.responsavel_interno_id
    WHERE c.tenant_id = v_tenant_id AND c.ativo = true
  ), '[]'::jsonb);
END;
$function$;

-- ── atribuir temperatura (percentual) ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_crm_card_temperatura_pct(p_user_id uuid, p_card_id uuid, p_pct integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_tenant_id uuid;
  v_pct smallint;
BEGIN
  SELECT tenant_id INTO v_tenant_id FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id AND tu.status = 'ativo' LIMIT 1;
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;

  v_pct := CASE WHEN p_pct IS NULL THEN NULL ELSE GREATEST(0, LEAST(100, p_pct)) END;

  UPDATE crm.pipeline_cards
  SET temperatura_pct = v_pct, updated_at = now(), updated_by = p_user_id
  WHERE id = p_card_id AND tenant_id = v_tenant_id AND ativo;

  IF NOT FOUND THEN RAISE EXCEPTION 'Card não encontrado'; END IF;
  RETURN jsonb_build_object('ok', true, 'card_id', p_card_id, 'temperatura_pct', v_pct);
END;
$function$;

-- ── info de clientes (segmento/cidade/uf) p/ refletir no card ────────────────
CREATE OR REPLACE FUNCTION public.get_crm_clientes_info(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_tenant_id uuid;
BEGIN
  SELECT tenant_id INTO v_tenant_id FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id AND tu.status = 'ativo' LIMIT 1;
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;

  RETURN COALESCE((
    SELECT jsonb_object_agg(cl.id, jsonb_build_object(
      'segmento_nome', (
        SELECT string_agg(seg.nome, ', ' ORDER BY seg.nome)
        FROM crm.clientes_segmentos cs
        JOIN crm.segmentos_economicos seg ON seg.id = cs.segmento_id
        WHERE cs.cliente_id = cl.id
      ),
      'cidade', cl.cidade,
      'estado', cl.estado
    ))
    FROM crm.clientes cl WHERE cl.tenant_id = v_tenant_id
  ), '{}'::jsonb);
END;
$function$;

-- ── get_crm_dashboard: por_temperatura agora em faixas de % ─────────────────
CREATE OR REPLACE FUNCTION public.get_crm_dashboard(p_user_id uuid)
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

  RETURN jsonb_build_object(
    'total', (SELECT count(*) FROM crm.pipeline_cards WHERE tenant_id = v_tenant_id AND ativo),
    'valor_total', (SELECT COALESCE(sum(valor), 0) FROM crm.pipeline_cards WHERE tenant_id = v_tenant_id AND ativo),
    'por_fase', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('label', etapa, 'count', n, 'valor', v) ORDER BY n DESC)
      FROM (SELECT etapa, count(*) n, COALESCE(sum(valor),0) v FROM crm.pipeline_cards WHERE tenant_id = v_tenant_id AND ativo GROUP BY etapa) s
    ), '[]'::jsonb),
    'por_centro_custo', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('label', COALESCE(ar.nome,'Sem centro de custo'), 'count', s.n, 'valor', s.v) ORDER BY s.n DESC)
      FROM (SELECT area_id, count(*) n, COALESCE(sum(valor),0) v FROM crm.pipeline_cards WHERE tenant_id = v_tenant_id AND ativo GROUP BY area_id) s
      LEFT JOIN people.areas ar ON ar.id = s.area_id
    ), '[]'::jsonb),
    'por_produto', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('label', COALESCE(p.nome,'Sem produto'), 'count', s.n, 'valor', s.v) ORDER BY s.n DESC)
      FROM (SELECT produto_id, count(*) n, COALESCE(sum(valor),0) v FROM crm.pipeline_cards WHERE tenant_id = v_tenant_id AND ativo GROUP BY produto_id) s
      LEFT JOIN contracts.produtos p ON p.id = s.produto_id
    ), '[]'::jsonb),
    'por_responsavel', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('label', COALESCE(col.nome,'Sem responsável'), 'count', s.n, 'valor', s.v) ORDER BY s.n DESC)
      FROM (SELECT responsavel_interno_id, count(*) n, COALESCE(sum(valor),0) v FROM crm.pipeline_cards WHERE tenant_id = v_tenant_id AND ativo GROUP BY responsavel_interno_id) s
      LEFT JOIN people.colaboradores col ON col.id = s.responsavel_interno_id
    ), '[]'::jsonb),
    'por_temperatura', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('label', faixa, 'count', n, 'valor', v) ORDER BY ord)
      FROM (
        SELECT
          CASE WHEN temperatura_pct IS NULL THEN 'Sem temperatura'
               WHEN temperatura_pct >= 67 THEN 'Quente (67-100%)'
               WHEN temperatura_pct >= 34 THEN 'Morna (34-66%)'
               ELSE 'Fria (0-33%)' END AS faixa,
          CASE WHEN temperatura_pct IS NULL THEN 9
               WHEN temperatura_pct >= 67 THEN 1
               WHEN temperatura_pct >= 34 THEN 2 ELSE 3 END AS ord,
          count(*) n, COALESCE(sum(valor),0) v
        FROM crm.pipeline_cards WHERE tenant_id = v_tenant_id AND ativo
        GROUP BY 1, 2
      ) s
    ), '[]'::jsonb),
    'por_localidade', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('uf', COALESCE(uf,'??'), 'count', n, 'valor', v) ORDER BY n DESC)
      FROM (
        SELECT cli.estado AS uf, count(*) n, COALESCE(sum(c.valor),0) v
        FROM crm.pipeline_cards c JOIN crm.clientes cli ON cli.id = c.cliente_id
        WHERE c.tenant_id = v_tenant_id AND c.ativo
        GROUP BY cli.estado
      ) s
    ), '[]'::jsonb),
    'por_segmento', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('label', COALESCE(seg.nome,'Sem segmento'), 'count', s.n, 'valor', s.v) ORDER BY s.n DESC)
      FROM (
        SELECT se.segmento_id, count(*) n, COALESCE(sum(c.valor),0) v
        FROM crm.pipeline_cards c
        LEFT JOIN crm.clientes_segmentos se ON se.cliente_id = c.cliente_id
        WHERE c.tenant_id = v_tenant_id AND c.ativo
        GROUP BY se.segmento_id
      ) s
      LEFT JOIN crm.segmentos_economicos seg ON seg.id = s.segmento_id
    ), '[]'::jsonb)
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.set_crm_card_temperatura_pct(uuid, uuid, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_crm_clientes_info(uuid) TO authenticated, service_role;
