-- CRM parte 2: atribuir/criar temperatura de fechamento nos cards.
-- get_crm_pipeline_cards passa a retornar temperatura_id/_nome; RPCs para listar,
-- criar e atribuir temperatura. Tudo SECURITY DEFINER (crm não é exposto).

-- ── get_crm_pipeline_cards + temperatura ────────────────────────────────────
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
  WHERE tu.user_id = p_user_id
    AND tu.status = 'ativo'
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
        'servico_id', c.servico_id,
        'servico_nome', srv.nome,
        'produto_id', c.produto_id,
        'produto_nome', prod.nome,
        'valor', COALESCE(c.valor, 0),
        'responsavel_interno_id', c.responsavel_interno_id,
        'responsavel_interno_nome', col.nome,
        'temperatura_id', c.temperatura_id,
        'temperatura_nome', tp.nome,
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
              'id', a.id,
              'nome', a.nome,
              'arquivo_nome', a.arquivo_nome,
              'mime_type', a.mime_type,
              'tamanho_bytes', a.tamanho_bytes,
              'created_at', a.created_at
            )
            ORDER BY a.created_at DESC
          )
          FROM crm.pipeline_card_anexos a
          WHERE a.card_id = c.id
        ), '[]'::jsonb)
      )
      ORDER BY
        CASE c.etapa
          WHEN 'prospeccao' THEN 1
          WHEN 'proposta_solicitada' THEN 2
          WHEN 'proposta_enviada' THEN 3
          WHEN 'conversao' THEN 4
          WHEN 'negada' THEN 5
          WHEN 'suspensa' THEN 6
          ELSE 99
        END,
        c.ordem ASC,
        c.created_at DESC
    )
    FROM crm.pipeline_cards c
    JOIN crm.clientes cli ON cli.id = c.cliente_id
    LEFT JOIN operations.categorias_servico srv ON srv.id = c.servico_id
    LEFT JOIN contracts.produtos prod ON prod.id = c.produto_id
    LEFT JOIN people.colaboradores col ON col.id = c.responsavel_interno_id
    LEFT JOIN crm.temperaturas tp ON tp.id = c.temperatura_id
    WHERE c.tenant_id = v_tenant_id
      AND c.ativo = true
  ), '[]'::jsonb);
END;
$function$;

-- ── listar temperaturas ativas ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.list_crm_temperaturas(p_user_id uuid)
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
    SELECT jsonb_agg(jsonb_build_object('id', id, 'nome', nome) ORDER BY ordem, nome)
    FROM crm.temperaturas WHERE tenant_id = v_tenant_id AND ativo
  ), '[]'::jsonb);
END;
$function$;

-- ── criar nova temperatura ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_crm_temperatura(p_user_id uuid, p_nome text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_tenant_id uuid;
  v_id uuid;
  v_nome text;
  v_ordem integer;
BEGIN
  SELECT tenant_id INTO v_tenant_id FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id AND tu.status = 'ativo' LIMIT 1;
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;

  v_nome := trim(p_nome);
  IF COALESCE(v_nome, '') = '' THEN RAISE EXCEPTION 'Nome da temperatura é obrigatório'; END IF;

  -- Reaproveita se já existir (case-insensitive)
  SELECT id INTO v_id FROM crm.temperaturas
  WHERE tenant_id = v_tenant_id AND lower(nome) = lower(v_nome) AND ativo LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN jsonb_build_object('id', v_id, 'nome', v_nome);
  END IF;

  SELECT COALESCE(max(ordem), 0) + 1 INTO v_ordem FROM crm.temperaturas WHERE tenant_id = v_tenant_id;

  INSERT INTO crm.temperaturas (tenant_id, nome, ordem, created_by)
  VALUES (v_tenant_id, v_nome, v_ordem, p_user_id)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('id', v_id, 'nome', v_nome);
END;
$function$;

-- ── atribuir temperatura a um card ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_crm_card_temperatura(p_user_id uuid, p_card_id uuid, p_temperatura_id uuid)
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

  -- valida temperatura do mesmo tenant (ou null para limpar)
  IF p_temperatura_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM crm.temperaturas WHERE id = p_temperatura_id AND tenant_id = v_tenant_id
  ) THEN
    RAISE EXCEPTION 'Temperatura não encontrada';
  END IF;

  UPDATE crm.pipeline_cards
  SET temperatura_id = p_temperatura_id, updated_at = now(), updated_by = p_user_id
  WHERE id = p_card_id AND tenant_id = v_tenant_id AND ativo;

  IF NOT FOUND THEN RAISE EXCEPTION 'Card não encontrado'; END IF;

  RETURN jsonb_build_object('ok', true, 'card_id', p_card_id, 'temperatura_id', p_temperatura_id);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.list_crm_temperaturas(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_crm_temperatura(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_crm_card_temperatura(uuid, uuid, uuid) TO authenticated, service_role;
