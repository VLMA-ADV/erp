-- CRM: campos novos no card + 2 colunas (etapas) novas.
-- Campos: data_card, valor_global, forma_pagamento, valor_caixa_mes, valor_futuro_projetado.
-- Etapas novas: em_standby (após prospecção) e exito_projetado (antes de conversão).

ALTER TABLE crm.pipeline_cards
  ADD COLUMN IF NOT EXISTS data_card date,
  ADD COLUMN IF NOT EXISTS valor_global numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS forma_pagamento varchar,
  ADD COLUMN IF NOT EXISTS valor_caixa_mes numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS valor_futuro_projetado numeric(14,2) NOT NULL DEFAULT 0;

-- CHECK de etapa com as 2 novas
ALTER TABLE crm.pipeline_cards DROP CONSTRAINT IF EXISTS pipeline_cards_etapa_check;
ALTER TABLE crm.pipeline_cards ADD CONSTRAINT pipeline_cards_etapa_check CHECK (
  (etapa)::text = ANY (ARRAY[
    'prospeccao','em_standby','proposta_solicitada','proposta_enviada','exito_projetado','conversao','negada','suspensa'
  ]::text[])
);

-- ── create_crm_pipeline_card ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_crm_pipeline_card(p_user_id uuid, p_payload jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
AS $function$
DECLARE
  v_tenant_id uuid; v_id uuid; v_cliente_id uuid; v_servico_id uuid; v_produto_id uuid;
  v_responsavel_id uuid; v_area_id uuid; v_etapa varchar; v_ordem integer; v_valor numeric(14,2); v_item jsonb;
BEGIN
  SELECT tenant_id INTO v_tenant_id FROM core.tenant_users tu WHERE tu.user_id = p_user_id AND tu.status = 'ativo' LIMIT 1;
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;

  IF NULLIF(p_payload->>'cliente_id', '') IS NULL THEN RAISE EXCEPTION 'Cliente é obrigatório'; END IF;
  v_cliente_id := (p_payload->>'cliente_id')::uuid;
  IF NOT EXISTS (SELECT 1 FROM crm.clientes c WHERE c.id = v_cliente_id AND c.tenant_id = v_tenant_id) THEN
    RAISE EXCEPTION 'Cliente não encontrado'; END IF;

  v_servico_id := NULLIF(p_payload->>'servico_id', '')::uuid;
  IF v_servico_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM operations.categorias_servico s WHERE s.id = v_servico_id AND s.tenant_id = v_tenant_id) THEN
    RAISE EXCEPTION 'Serviço não encontrado'; END IF;

  v_produto_id := NULLIF(p_payload->>'produto_id', '')::uuid;
  IF v_produto_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM contracts.produtos p WHERE p.id = v_produto_id AND p.tenant_id = v_tenant_id) THEN
    RAISE EXCEPTION 'Produto não encontrado'; END IF;

  v_responsavel_id := NULLIF(p_payload->>'responsavel_interno_id', '')::uuid;
  IF v_responsavel_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM people.colaboradores col WHERE col.id = v_responsavel_id AND col.tenant_id = v_tenant_id) THEN
    RAISE EXCEPTION 'Responsável interno não encontrado'; END IF;

  v_area_id := NULLIF(p_payload->>'area_id', '')::uuid;
  IF v_area_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM people.areas a WHERE a.id = v_area_id AND a.tenant_id = v_tenant_id AND a.ativo = true) THEN
    RAISE EXCEPTION 'Área não encontrada'; END IF;

  v_etapa := lower(COALESCE(NULLIF(p_payload->>'etapa', ''), 'prospeccao'));
  IF v_etapa NOT IN ('prospeccao','em_standby','proposta_solicitada','proposta_enviada','exito_projetado','conversao','negada','suspensa') THEN
    RAISE EXCEPTION 'Etapa inválida'; END IF;

  v_valor := COALESCE(NULLIF(replace(p_payload->>'valor', ',', '.'), '')::numeric, 0);
  IF v_valor < 0 THEN RAISE EXCEPTION 'Valor inválido'; END IF;

  v_ordem := NULLIF(p_payload->>'ordem', '')::integer;
  IF v_ordem IS NULL OR v_ordem < 1 THEN
    SELECT COALESCE(MAX(c.ordem), 0) + 1 INTO v_ordem FROM crm.pipeline_cards c WHERE c.tenant_id = v_tenant_id AND c.etapa = v_etapa;
  END IF;

  INSERT INTO crm.pipeline_cards (
    tenant_id, cliente_id, servico_id, produto_id, valor, responsavel_interno_id, area_id,
    observacoes, etapa, ordem,
    data_card, valor_global, forma_pagamento, valor_caixa_mes, valor_futuro_projetado,
    created_by, updated_by
  ) VALUES (
    v_tenant_id, v_cliente_id, v_servico_id, v_produto_id, v_valor, v_responsavel_id, v_area_id,
    COALESCE(p_payload->>'observacoes', ''), v_etapa, v_ordem,
    NULLIF(p_payload->>'data_card','')::date,
    COALESCE(NULLIF(replace(p_payload->>'valor_global', ',', '.'), '')::numeric, 0),
    NULLIF(p_payload->>'forma_pagamento',''),
    COALESCE(NULLIF(replace(p_payload->>'valor_caixa_mes', ',', '.'), '')::numeric, 0),
    COALESCE(NULLIF(replace(p_payload->>'valor_futuro_projetado', ',', '.'), '')::numeric, 0),
    p_user_id, p_user_id
  ) RETURNING id INTO v_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(p_payload->'anexos', '[]'::jsonb)) LOOP
    IF COALESCE(NULLIF(trim(v_item->>'arquivo_base64'), ''), '') = '' THEN CONTINUE; END IF;
    INSERT INTO crm.pipeline_card_anexos (tenant_id, card_id, nome, arquivo_nome, mime_type, tamanho_bytes, arquivo, created_by)
    VALUES (v_tenant_id, v_id, COALESCE(NULLIF(trim(v_item->>'nome'),''),'Anexo'), COALESCE(NULLIF(trim(v_item->>'arquivo_nome'),''),'anexo.bin'),
      NULLIF(v_item->>'mime_type',''), NULLIF(v_item->>'tamanho_bytes','')::bigint, decode(v_item->>'arquivo_base64','base64'), p_user_id);
  END LOOP;

  RETURN jsonb_build_object('id', v_id);
END;
$function$;

-- ── update_crm_pipeline_card ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_crm_pipeline_card(p_user_id uuid, p_card_id uuid, p_payload jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
AS $function$
DECLARE
  v_tenant_id uuid; v_current crm.pipeline_cards%ROWTYPE; v_cliente_id uuid; v_servico_id uuid; v_produto_id uuid;
  v_responsavel_id uuid; v_area_id uuid; v_etapa varchar; v_ordem integer; v_valor numeric(14,2); v_item jsonb;
BEGIN
  SELECT tenant_id INTO v_tenant_id FROM core.tenant_users tu WHERE tu.user_id = p_user_id AND tu.status = 'ativo' LIMIT 1;
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;

  SELECT * INTO v_current FROM crm.pipeline_cards c WHERE c.id = p_card_id AND c.tenant_id = v_tenant_id AND c.ativo = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Card não encontrado'; END IF;

  IF p_payload ? 'cliente_id' THEN
    v_cliente_id := NULLIF(p_payload->>'cliente_id', '')::uuid;
    IF v_cliente_id IS NULL THEN RAISE EXCEPTION 'Cliente é obrigatório'; END IF;
    IF NOT EXISTS (SELECT 1 FROM crm.clientes c WHERE c.id = v_cliente_id AND c.tenant_id = v_tenant_id) THEN RAISE EXCEPTION 'Cliente não encontrado'; END IF;
  ELSE v_cliente_id := v_current.cliente_id; END IF;

  IF p_payload ? 'servico_id' THEN
    v_servico_id := NULLIF(p_payload->>'servico_id', '')::uuid;
    IF v_servico_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM operations.categorias_servico s WHERE s.id = v_servico_id AND s.tenant_id = v_tenant_id) THEN RAISE EXCEPTION 'Serviço não encontrado'; END IF;
  ELSE v_servico_id := v_current.servico_id; END IF;

  IF p_payload ? 'produto_id' THEN
    v_produto_id := NULLIF(p_payload->>'produto_id', '')::uuid;
    IF v_produto_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM contracts.produtos p WHERE p.id = v_produto_id AND p.tenant_id = v_tenant_id) THEN RAISE EXCEPTION 'Produto não encontrado'; END IF;
  ELSE v_produto_id := v_current.produto_id; END IF;

  IF p_payload ? 'responsavel_interno_id' THEN
    v_responsavel_id := NULLIF(p_payload->>'responsavel_interno_id', '')::uuid;
    IF v_responsavel_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM people.colaboradores col WHERE col.id = v_responsavel_id AND col.tenant_id = v_tenant_id) THEN RAISE EXCEPTION 'Responsável interno não encontrado'; END IF;
  ELSE v_responsavel_id := v_current.responsavel_interno_id; END IF;

  IF p_payload ? 'area_id' THEN
    v_area_id := NULLIF(p_payload->>'area_id', '')::uuid;
    IF v_area_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM people.areas a WHERE a.id = v_area_id AND a.tenant_id = v_tenant_id AND a.ativo = true) THEN RAISE EXCEPTION 'Área não encontrada'; END IF;
  ELSE v_area_id := v_current.area_id; END IF;

  IF p_payload ? 'etapa' THEN
    v_etapa := lower(COALESCE(NULLIF(p_payload->>'etapa', ''), v_current.etapa));
    IF v_etapa NOT IN ('prospeccao','em_standby','proposta_solicitada','proposta_enviada','exito_projetado','conversao','negada','suspensa') THEN RAISE EXCEPTION 'Etapa inválida'; END IF;
  ELSE v_etapa := v_current.etapa; END IF;

  IF p_payload ? 'ordem' THEN
    v_ordem := NULLIF(p_payload->>'ordem', '')::integer;
    IF v_ordem IS NULL OR v_ordem < 1 THEN v_ordem := v_current.ordem; END IF;
  ELSE
    IF v_etapa <> v_current.etapa THEN
      SELECT COALESCE(MAX(c.ordem), 0) + 1 INTO v_ordem FROM crm.pipeline_cards c WHERE c.tenant_id = v_tenant_id AND c.etapa = v_etapa;
    ELSE v_ordem := v_current.ordem; END IF;
  END IF;

  IF p_payload ? 'valor' THEN
    v_valor := COALESCE(NULLIF(replace(p_payload->>'valor', ',', '.'), '')::numeric, 0);
    IF v_valor < 0 THEN RAISE EXCEPTION 'Valor inválido'; END IF;
  ELSE v_valor := v_current.valor; END IF;

  UPDATE crm.pipeline_cards c SET
    cliente_id = v_cliente_id, servico_id = v_servico_id, produto_id = v_produto_id, valor = v_valor,
    responsavel_interno_id = v_responsavel_id, area_id = v_area_id,
    observacoes = CASE WHEN p_payload ? 'observacoes' THEN COALESCE(p_payload->>'observacoes', '') ELSE c.observacoes END,
    etapa = v_etapa, ordem = v_ordem,
    data_card = CASE WHEN p_payload ? 'data_card' THEN NULLIF(p_payload->>'data_card','')::date ELSE c.data_card END,
    valor_global = CASE WHEN p_payload ? 'valor_global' THEN COALESCE(NULLIF(replace(p_payload->>'valor_global',',','.'),'')::numeric,0) ELSE c.valor_global END,
    forma_pagamento = CASE WHEN p_payload ? 'forma_pagamento' THEN NULLIF(p_payload->>'forma_pagamento','') ELSE c.forma_pagamento END,
    valor_caixa_mes = CASE WHEN p_payload ? 'valor_caixa_mes' THEN COALESCE(NULLIF(replace(p_payload->>'valor_caixa_mes',',','.'),'')::numeric,0) ELSE c.valor_caixa_mes END,
    valor_futuro_projetado = CASE WHEN p_payload ? 'valor_futuro_projetado' THEN COALESCE(NULLIF(replace(p_payload->>'valor_futuro_projetado',',','.'),'')::numeric,0) ELSE c.valor_futuro_projetado END,
    converted_solicitacao_id = CASE WHEN p_payload ? 'converted_solicitacao_id' THEN NULLIF(p_payload->>'converted_solicitacao_id', '')::uuid ELSE c.converted_solicitacao_id END,
    updated_at = now(), updated_by = p_user_id
  WHERE c.id = p_card_id AND c.tenant_id = v_tenant_id;

  IF p_payload ? 'remove_anexo_ids' THEN
    DELETE FROM crm.pipeline_card_anexos a WHERE a.card_id = p_card_id AND a.tenant_id = v_tenant_id
      AND a.id IN (SELECT value::uuid FROM jsonb_array_elements_text(COALESCE(p_payload->'remove_anexo_ids', '[]'::jsonb)));
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(p_payload->'anexos', '[]'::jsonb)) LOOP
    IF COALESCE(NULLIF(trim(v_item->>'arquivo_base64'), ''), '') = '' THEN CONTINUE; END IF;
    INSERT INTO crm.pipeline_card_anexos (tenant_id, card_id, nome, arquivo_nome, mime_type, tamanho_bytes, arquivo, created_by)
    VALUES (v_tenant_id, p_card_id, COALESCE(NULLIF(trim(v_item->>'nome'),''),'Anexo'), COALESCE(NULLIF(trim(v_item->>'arquivo_nome'),''),'anexo.bin'),
      NULLIF(v_item->>'mime_type',''), NULLIF(v_item->>'tamanho_bytes','')::bigint, decode(v_item->>'arquivo_base64','base64'), p_user_id);
  END LOOP;

  RETURN jsonb_build_object('id', p_card_id);
END;
$function$;

-- ── move_crm_pipeline_card ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.move_crm_pipeline_card(p_user_id uuid, p_card_id uuid, p_etapa character varying, p_ordem integer DEFAULT NULL::integer)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
AS $function$
DECLARE v_tenant_id uuid; v_etapa varchar; v_ordem integer;
BEGIN
  SELECT tenant_id INTO v_tenant_id FROM core.tenant_users tu WHERE tu.user_id = p_user_id AND tu.status = 'ativo' LIMIT 1;
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;

  v_etapa := lower(COALESCE(NULLIF(p_etapa, ''), ''));
  IF v_etapa NOT IN ('prospeccao','em_standby','proposta_solicitada','proposta_enviada','exito_projetado','conversao','negada','suspensa') THEN
    RAISE EXCEPTION 'Etapa inválida'; END IF;

  v_ordem := p_ordem;
  IF v_ordem IS NULL OR v_ordem < 1 THEN
    SELECT COALESCE(MAX(c.ordem), 0) + 1 INTO v_ordem FROM crm.pipeline_cards c WHERE c.tenant_id = v_tenant_id AND c.etapa = v_etapa;
  END IF;

  UPDATE crm.pipeline_cards c SET etapa = v_etapa, ordem = v_ordem, updated_at = now(), updated_by = p_user_id
  WHERE c.id = p_card_id AND c.tenant_id = v_tenant_id AND c.ativo = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Card não encontrado'; END IF;

  RETURN jsonb_build_object('id', p_card_id, 'etapa', v_etapa, 'ordem', v_ordem);
END;
$function$;

-- ── get_crm_pipeline_cards: + campos novos e ordenação com as 2 etapas ──────
CREATE OR REPLACE FUNCTION public.get_crm_pipeline_cards(p_user_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
AS $function$
DECLARE v_tenant_id uuid;
BEGIN
  SELECT tenant_id INTO v_tenant_id FROM core.tenant_users tu WHERE tu.user_id = p_user_id AND tu.status = 'ativo' LIMIT 1;
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', c.id,
        'cliente_id', c.cliente_id,
        'cliente_nome', cli.nome,
        'segmento_nome', (
          SELECT string_agg(seg.nome, ', ' ORDER BY seg.nome)
          FROM crm.clientes_segmentos cs JOIN crm.segmentos_economicos seg ON seg.id = cs.segmento_id
          WHERE cs.cliente_id = c.cliente_id
        ),
        'cidade', cli.cidade, 'estado', cli.estado,
        'servico_id', c.servico_id, 'servico_nome', srv.nome,
        'produto_id', c.produto_id, 'produto_nome', prod.nome,
        'valor', COALESCE(c.valor, 0),
        'responsavel_interno_id', c.responsavel_interno_id, 'responsavel_interno_nome', col.nome,
        'temperatura_pct', c.temperatura_pct,
        'area_id', c.area_id,
        'data_card', c.data_card,
        'valor_global', COALESCE(c.valor_global, 0),
        'forma_pagamento', c.forma_pagamento,
        'valor_caixa_mes', COALESCE(c.valor_caixa_mes, 0),
        'valor_futuro_projetado', COALESCE(c.valor_futuro_projetado, 0),
        'observacoes', c.observacoes, 'etapa', c.etapa, 'ordem', c.ordem, 'ativo', c.ativo,
        'converted_solicitacao_id', c.converted_solicitacao_id,
        'created_at', c.created_at, 'updated_at', c.updated_at,
        'anexos', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('id', a.id, 'nome', a.nome, 'arquivo_nome', a.arquivo_nome,
            'mime_type', a.mime_type, 'tamanho_bytes', a.tamanho_bytes, 'created_at', a.created_at) ORDER BY a.created_at DESC)
          FROM crm.pipeline_card_anexos a WHERE a.card_id = c.id), '[]'::jsonb)
      )
      ORDER BY
        CASE c.etapa
          WHEN 'prospeccao' THEN 1 WHEN 'em_standby' THEN 2 WHEN 'proposta_solicitada' THEN 3
          WHEN 'proposta_enviada' THEN 4 WHEN 'exito_projetado' THEN 5 WHEN 'conversao' THEN 6
          WHEN 'negada' THEN 7 WHEN 'suspensa' THEN 8 ELSE 99
        END, c.ordem ASC, c.created_at DESC
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
