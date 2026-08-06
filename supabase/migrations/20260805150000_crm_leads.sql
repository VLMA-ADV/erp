-- CRM1 · Leads no pipeline (pedido Filipe 04/08).
--
-- O cliente confirmou: o card nasce como lead e, depois da conversao, CONTINUA
-- o mesmo card, agora apontando para um cliente de verdade. Por isso nao ha
-- tabela separada de leads — o que muda e que cliente_id passa a poder ser nulo
-- enquanto a oportunidade ainda e um lead.
--
-- O CHECK garante que um card nunca fica anonimo: ou tem cliente, ou tem nome
-- de lead. Os 71 cards atuais tem cliente, entao nenhum e afetado.

ALTER TABLE crm.pipeline_cards ALTER COLUMN cliente_id DROP NOT NULL;

ALTER TABLE crm.pipeline_cards
  ADD COLUMN IF NOT EXISTS lead_nome text,
  ADD COLUMN IF NOT EXISTS lead_email text,
  ADD COLUMN IF NOT EXISTS lead_contato text,
  ADD COLUMN IF NOT EXISTS lead_segmento_id uuid REFERENCES crm.segmentos_economicos(id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='pipeline_cards_cliente_ou_lead') THEN
    ALTER TABLE crm.pipeline_cards ADD CONSTRAINT pipeline_cards_cliente_ou_lead
      CHECK (cliente_id IS NOT NULL OR NULLIF(trim(lead_nome), '') IS NOT NULL);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.get_crm_pipeline_cards(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
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
        'cliente_nome', COALESCE(cli.nome, c.lead_nome),
        'eh_lead', (c.cliente_id IS NULL),
        'lead_nome', c.lead_nome,
        'lead_email', c.lead_email,
        'lead_contato', c.lead_contato,
        'lead_segmento_id', c.lead_segmento_id,
        'segmento_nome', COALESCE((
          SELECT string_agg(seg.nome, ', ' ORDER BY seg.nome)
          FROM crm.clientes_segmentos cs JOIN crm.segmentos_economicos seg ON seg.id = cs.segmento_id
          WHERE cs.cliente_id = c.cliente_id
        ), (SELECT sg.nome FROM crm.segmentos_economicos sg WHERE sg.id = c.lead_segmento_id)),
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
        'data_projetada', c.data_projetada,
        'valor_faturado_prox_mes', COALESCE(c.valor_faturado_prox_mes, 0),
        'regra_cobranca', c.regra_cobranca,
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
    LEFT JOIN crm.clientes cli ON cli.id = c.cliente_id
    LEFT JOIN operations.categorias_servico srv ON srv.id = c.servico_id
    LEFT JOIN contracts.produtos prod ON prod.id = c.produto_id
    LEFT JOIN people.colaboradores col ON col.id = c.responsavel_interno_id
    WHERE c.tenant_id = v_tenant_id AND c.ativo = true
  ), '[]'::jsonb);
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_crm_pipeline_card(p_user_id uuid, p_card_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
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
    IF v_cliente_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM crm.clientes c WHERE c.id = v_cliente_id AND c.tenant_id = v_tenant_id) THEN RAISE EXCEPTION 'Cliente não encontrado'; END IF;
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
    regra_cobranca = CASE WHEN p_payload ? 'regra_cobranca' THEN NULLIF(p_payload->>'regra_cobranca','') ELSE c.regra_cobranca END,
    data_projetada = CASE WHEN p_payload ? 'data_projetada' THEN NULLIF(p_payload->>'data_projetada','')::date ELSE c.data_projetada END,
    valor_faturado_prox_mes = CASE WHEN p_payload ? 'valor_faturado_prox_mes' THEN COALESCE(NULLIF(replace(p_payload->>'valor_faturado_prox_mes',',','.'),'')::numeric,0) ELSE c.valor_faturado_prox_mes END,
    lead_nome = CASE WHEN p_payload ? 'lead_nome' THEN NULLIF(trim(p_payload->>'lead_nome'),'') ELSE c.lead_nome END,
    lead_email = CASE WHEN p_payload ? 'lead_email' THEN NULLIF(trim(p_payload->>'lead_email'),'') ELSE c.lead_email END,
    lead_contato = CASE WHEN p_payload ? 'lead_contato' THEN NULLIF(trim(p_payload->>'lead_contato'),'') ELSE c.lead_contato END,
    lead_segmento_id = CASE WHEN p_payload ? 'lead_segmento_id' THEN NULLIF(p_payload->>'lead_segmento_id','')::uuid ELSE c.lead_segmento_id END,
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

CREATE OR REPLACE FUNCTION public.create_crm_pipeline_card(p_user_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_tenant_id uuid; v_id uuid; v_cliente_id uuid; v_servico_id uuid; v_produto_id uuid;
  v_responsavel_id uuid; v_area_id uuid; v_etapa varchar; v_ordem integer; v_valor numeric(14,2); v_item jsonb;
BEGIN
  SELECT tenant_id INTO v_tenant_id FROM core.tenant_users tu WHERE tu.user_id = p_user_id AND tu.status = 'ativo' LIMIT 1;
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;

  -- Card de lead nao tem cliente ainda: exige cliente OU nome do lead.
  v_cliente_id := NULLIF(p_payload->>'cliente_id', '')::uuid;
  IF v_cliente_id IS NULL AND COALESCE(NULLIF(trim(p_payload->>'lead_nome'), ''), '') = '' THEN
    RAISE EXCEPTION 'Informe o cliente ou o nome do lead';
  END IF;
  IF v_cliente_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM crm.clientes c WHERE c.id = v_cliente_id AND c.tenant_id = v_tenant_id) THEN
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
    data_projetada, valor_faturado_prox_mes,
    lead_nome, lead_email, lead_contato, lead_segmento_id,
    created_by, updated_by
  ) VALUES (
    v_tenant_id, v_cliente_id, v_servico_id, v_produto_id, v_valor, v_responsavel_id, v_area_id,
    COALESCE(p_payload->>'observacoes', ''), v_etapa, v_ordem,
    NULLIF(p_payload->>'data_card','')::date,
    COALESCE(NULLIF(replace(p_payload->>'valor_global', ',', '.'), '')::numeric, 0),
    NULLIF(p_payload->>'forma_pagamento',''),
    COALESCE(NULLIF(replace(p_payload->>'valor_caixa_mes', ',', '.'), '')::numeric, 0),
    COALESCE(NULLIF(replace(p_payload->>'valor_futuro_projetado', ',', '.'), '')::numeric, 0),
    NULLIF(p_payload->>'data_projetada','')::date,
    COALESCE(NULLIF(replace(p_payload->>'valor_faturado_prox_mes', ',', '.'), '')::numeric, 0),
    NULLIF(trim(p_payload->>'lead_nome'),''), NULLIF(trim(p_payload->>'lead_email'),''),
    NULLIF(trim(p_payload->>'lead_contato'),''), NULLIF(p_payload->>'lead_segmento_id','')::uuid,
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
        FROM crm.pipeline_cards c LEFT JOIN crm.clientes cli ON cli.id = c.cliente_id
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


-- Atalho de cadastro: cria o cliente a partir do que ja foi digitado no lead e
-- aponta o card para ele. O card fica onde esta, na mesma etapa e com os mesmos
-- valores — converter um lead nao e comecar de novo, e so parar de ser lead.
CREATE OR REPLACE FUNCTION public.converter_lead_em_cliente(
  p_user_id uuid,
  p_card_id uuid,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_tenant_id uuid;
  v_card crm.pipeline_cards%ROWTYPE;
  v_nome text;
  v_email text;
  v_telefone text;
  v_segmento uuid;
  v_cnpj text;
  v_estrangeiro boolean;
  v_cliente_id uuid;
BEGIN
  SELECT tenant_id INTO v_tenant_id FROM core.tenant_users tu
   WHERE tu.user_id = p_user_id AND tu.status = 'ativo' LIMIT 1;
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;

  SELECT * INTO v_card FROM crm.pipeline_cards c
   WHERE c.id = p_card_id AND c.tenant_id = v_tenant_id AND c.ativo = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Card não encontrado'; END IF;

  IF v_card.cliente_id IS NOT NULL THEN
    RAISE EXCEPTION 'Este card já está ligado a um cliente';
  END IF;

  -- O payload pode corrigir o que veio do lead; sem payload, usa o do card.
  v_nome     := COALESCE(NULLIF(trim(p_payload->>'nome'), ''), v_card.lead_nome);
  v_email    := COALESCE(NULLIF(trim(p_payload->>'email'), ''), v_card.lead_email);
  v_telefone := COALESCE(NULLIF(trim(p_payload->>'telefone'), ''), v_card.lead_contato);
  v_segmento := COALESCE(NULLIF(p_payload->>'segmento_id', '')::uuid, v_card.lead_segmento_id);

  IF COALESCE(v_nome, '') = '' THEN RAISE EXCEPTION 'Nome do cliente é obrigatório'; END IF;

  -- Cliente do escritorio precisa de CNPJ/CPF, salvo estrangeiro (regra que ja
  -- existia em crm.clientes). O lead nao guarda esse dado, entao ele e pedido
  -- na conversao — que e exatamente quando ele aparece.
  v_cnpj := NULLIF(regexp_replace(COALESCE(p_payload->>'cnpj', ''), '[^0-9]', '', 'g'), '');
  v_estrangeiro := COALESCE((p_payload->>'cliente_estrangeiro')::boolean, false);
  IF v_cnpj IS NULL AND NOT v_estrangeiro THEN
    RAISE EXCEPTION 'Informe o CNPJ/CPF do cliente, ou marque como cliente estrangeiro';
  END IF;

  -- Nome repetido costuma ser o mesmo cliente cadastrado duas vezes; reaproveita
  -- em vez de criar duplicata, que e o problema que ninguem percebe na hora.
  SELECT id INTO v_cliente_id FROM crm.clientes
   WHERE tenant_id = v_tenant_id AND lower(trim(nome)) = lower(trim(v_nome)) LIMIT 1;

  IF v_cliente_id IS NULL THEN
    INSERT INTO crm.clientes (tenant_id, nome, email, telefone, cnpj, cliente_estrangeiro)
    VALUES (v_tenant_id, v_nome, v_email, v_telefone, v_cnpj, v_estrangeiro)
    RETURNING id INTO v_cliente_id;
  END IF;

  IF v_segmento IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM crm.clientes_segmentos cs
     WHERE cs.cliente_id = v_cliente_id AND cs.segmento_id = v_segmento
  ) THEN
    INSERT INTO crm.clientes_segmentos (cliente_id, segmento_id) VALUES (v_cliente_id, v_segmento);
  END IF;

  UPDATE crm.pipeline_cards SET
    cliente_id = v_cliente_id,
    updated_at = now(), updated_by = p_user_id
  WHERE id = p_card_id AND tenant_id = v_tenant_id;

  RETURN jsonb_build_object('cliente_id', v_cliente_id, 'card_id', p_card_id);
END;
$function$;
