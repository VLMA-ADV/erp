-- Caixa de entrada de contratos (pedido Filipe 07/08).
--
-- A solicitacao passa a carregar tudo que quem monta o contrato precisa, e o
-- botao "Abrir contrato" leva os campos adiante. Hoje o contrato nascia so com
-- o cliente e um nome automatico; nome do caso, centro de custo e descricao
-- ficavam guardados na solicitacao sem ninguem ler.
--
-- Centro de custo e responsavel sao LISTAS, nao texto livre: os dois ja existem
-- cadastrados, e texto livre nunca casa com o cadastro.
-- O destinatario e opcional — so quando o solicitante quer dirigir o pedido.

ALTER TABLE contracts.solicitacoes_contrato
  ADD COLUMN IF NOT EXISTS responsavel_vlma_id uuid,
  ADD COLUMN IF NOT EXISTS regra_cobranca_texto text,
  ADD COLUMN IF NOT EXISTS indicacao_cross_sell text,
  ADD COLUMN IF NOT EXISTS contatos_financeiro text,
  ADD COLUMN IF NOT EXISTS destinatario_user_id uuid,
  ADD COLUMN IF NOT EXISTS providenciada_em timestamptz,
  ADD COLUMN IF NOT EXISTS providenciada_por uuid;
CREATE OR REPLACE FUNCTION public.create_solicitacao_contrato(p_user_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'core', 'contracts', 'crm', 'people'
AS $function$
DECLARE
  v_tenant_id uuid;
  v_id uuid;
  v_item jsonb;
  v_cliente_id uuid;
  v_nome text;
  v_descricao text;
  v_nome_cliente_novo text;
  v_responsavel_id uuid;
  v_destinatario_id uuid;
  v_cnpj_cliente_novo text;
  v_centro_custo_id uuid;
  v_anexos_count int;
  v_arquivo_nome text;
  v_mime_type text;
  v_tamanho_bytes bigint;
  v_arquivo bytea;
BEGIN
  SELECT tenant_id INTO v_tenant_id
  FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id AND tu.status = 'ativo'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não associado a tenant';
  END IF;

  IF COALESCE(trim(p_payload->>'nome'), '') = '' THEN
    RAISE EXCEPTION 'Nome é obrigatório';
  END IF;

  IF NULLIF(p_payload->>'cliente_id', '') IS NULL THEN
    RAISE EXCEPTION 'Cliente é obrigatório';
  END IF;

  v_cliente_id := (p_payload->>'cliente_id')::uuid;
  v_nome := trim(p_payload->>'nome');
  v_descricao := NULLIF(trim(p_payload->>'descricao'), '');
  v_descricao := COALESCE(v_descricao, v_nome);
  v_nome_cliente_novo := p_payload->>'nome_cliente_novo';
  v_cnpj_cliente_novo := p_payload->>'cnpj_cliente_novo';
  v_centro_custo_id := (NULLIF(p_payload->>'centro_custo_id', ''))::uuid;
  v_anexos_count := COALESCE(jsonb_array_length(COALESCE(p_payload->'anexos', '[]'::jsonb)), 0);

  IF NOT EXISTS (
    SELECT 1
    FROM crm.clientes c
    WHERE c.id = v_cliente_id
      AND c.tenant_id = v_tenant_id
  ) THEN
    RAISE EXCEPTION 'Cliente não encontrado';
  END IF;

  -- Responsavel VLMA e destinatario sao listas do proprio sistema, nao texto
  -- livre: texto livre nunca casa com o cadastro e o dado nao serve pra nada.
  -- Os dois sao opcionais — o destinatario so existe quando o solicitante quer
  -- dirigir o pedido a alguem (Filipe, 07/08).
  v_responsavel_id := NULLIF(p_payload->>'responsavel_vlma_id', '')::uuid;
  IF v_responsavel_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM people.colaboradores co WHERE co.id = v_responsavel_id AND co.tenant_id = v_tenant_id
  ) THEN
    RAISE EXCEPTION 'Responsável não encontrado';
  END IF;

  v_destinatario_id := NULLIF(p_payload->>'destinatario_user_id', '')::uuid;
  IF v_destinatario_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM people.colaboradores co WHERE co.user_id = v_destinatario_id AND co.tenant_id = v_tenant_id
  ) THEN
    RAISE EXCEPTION 'Destinatário não encontrado';
  END IF;

  -- IMPORTANTE: NÃO cria contrato automático.
  -- contrato_id permanece NULL — solicitação fica disponível no inbox para
  -- aprovação manual (futuro: botão que aciona link_contrato_rascunho_para_solicitacao).
  INSERT INTO contracts.solicitacoes_contrato (
    tenant_id,
    nome,
    descricao,
    status,
    cliente_id,
    contrato_id,
    solicitante_user_id,
    created_by,
    updated_by,
    nome_cliente_novo,
    cnpj_cliente_novo,
    centro_custo_id,
    responsavel_vlma_id,
    regra_cobranca_texto,
    indicacao_cross_sell,
    contatos_financeiro,
    destinatario_user_id
  ) VALUES (
    v_tenant_id,
    v_nome,
    v_descricao,
    'aberta',
    v_cliente_id,
    NULL,
    p_user_id,
    p_user_id,
    p_user_id,
    v_nome_cliente_novo,
    v_cnpj_cliente_novo,
    v_centro_custo_id,
    v_responsavel_id,
    NULLIF(trim(p_payload->>'regra_cobranca_texto'), ''),
    NULLIF(trim(p_payload->>'indicacao_cross_sell'), ''),
    NULLIF(trim(p_payload->>'contatos_financeiro'), ''),
    v_destinatario_id
  ) RETURNING id INTO v_id;

  -- Anexos: persiste APENAS em solicitacoes_contrato_anexos (não espelha em
  -- contrato_anexos pois não há contrato).
  IF v_anexos_count > 0 THEN
    FOR v_item IN
      SELECT value FROM jsonb_array_elements(COALESCE(p_payload->'anexos', '[]'::jsonb))
    LOOP
      IF NULLIF(v_item->>'nome', '') IS NULL OR NULLIF(v_item->>'arquivo_base64', '') IS NULL THEN
        CONTINUE;
      END IF;

      v_arquivo_nome := COALESCE(NULLIF(v_item->>'arquivo_nome', ''), 'anexo.bin');
      v_mime_type := NULLIF(v_item->>'mime_type', '');
      v_tamanho_bytes := NULLIF(v_item->>'tamanho_bytes', '')::bigint;
      v_arquivo := decode(v_item->>'arquivo_base64', 'base64');

      INSERT INTO contracts.solicitacoes_contrato_anexos (
        tenant_id,
        solicitacao_id,
        nome,
        arquivo_nome,
        mime_type,
        tamanho_bytes,
        arquivo,
        created_by
      ) VALUES (
        v_tenant_id,
        v_id,
        'Proposta',
        v_arquivo_nome,
        v_mime_type,
        v_tamanho_bytes,
        v_arquivo,
        p_user_id
      );
    END LOOP;
  END IF;

  -- Conversão via CRM: leva os anexos da proposta (card) junto para a
  -- solicitação — antes eles ficavam para trás (feedback 20/07).
  IF NULLIF(p_payload->>'origem_card_id', '') IS NOT NULL THEN
    INSERT INTO contracts.solicitacoes_contrato_anexos (
      tenant_id, solicitacao_id, nome, arquivo_nome, mime_type, tamanho_bytes, arquivo, created_by
    )
    SELECT v_tenant_id, v_id, COALESCE(NULLIF(a.nome, ''), 'Proposta'), a.arquivo_nome, a.mime_type, a.tamanho_bytes, a.arquivo, p_user_id
    FROM crm.pipeline_card_anexos a
    WHERE a.card_id = (p_payload->>'origem_card_id')::uuid
      AND a.tenant_id = v_tenant_id
      AND a.arquivo IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM contracts.solicitacoes_contrato_anexos s
        WHERE s.solicitacao_id = v_id AND s.arquivo_nome = a.arquivo_nome
      );
  END IF;

  RETURN jsonb_build_object('id', v_id, 'contrato_id', NULL);
END;
$function$;
CREATE OR REPLACE FUNCTION public.get_solicitacoes_contrato(p_user_id uuid, p_only_unread boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_tenant_id uuid;
  v_is_manager boolean;
BEGIN
  SELECT tenant_id INTO v_tenant_id
  FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id AND tu.status = 'ativo'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Usuario nao associado a tenant';
  END IF;

  v_is_manager := public.is_admin_or_socio(p_user_id, v_tenant_id);

  RETURN COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', s.id,
        'descricao', s.descricao,
        'status', s.status,
        'cliente_id', COALESCE(s.cliente_id, c.cliente_id),
        'cliente_nome', COALESCE(cli.nome, cli_contrato.nome),
        'contrato_id', s.contrato_id,
        'contrato_numero', c.numero,
        'contrato_numero_sequencial', c.numero_sequencial,
        'contrato_nome', c.nome_contrato,
        'nome', s.nome,
        'solicitante_user_id', s.solicitante_user_id,
        'solicitante_nome', col.nome,
        'solicitante_foto', col.foto_url,
        -- Campos que quem monta o contrato precisa ler (Filipe 07/08).
        'centro_custo_id', s.centro_custo_id,
        'centro_custo_nome', ar.nome,
        'responsavel_vlma_id', s.responsavel_vlma_id,
        'responsavel_vlma_nome', resp.nome,
        'regra_cobranca_texto', s.regra_cobranca_texto,
        'indicacao_cross_sell', s.indicacao_cross_sell,
        'contatos_financeiro', s.contatos_financeiro,
        'destinatario_user_id', s.destinatario_user_id,
        'destinatario_nome', dest.nome,
        'providenciada_em', s.providenciada_em,
        'concluida_em', s.concluida_em,
        'lido_at', s.lido_at,
        'created_at', s.created_at,
        'anexos', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id', a.id,
            'nome', a.nome,
            'arquivo_nome', a.arquivo_nome,
            'mime_type', a.mime_type,
            'tamanho_bytes', a.tamanho_bytes,
            'created_at', a.created_at
          ) ORDER BY a.created_at DESC)
          FROM contracts.solicitacoes_contrato_anexos a
          WHERE a.solicitacao_id = s.id
        ), '[]'::jsonb)
      )
      ORDER BY s.created_at DESC
    )
    FROM contracts.solicitacoes_contrato s
    LEFT JOIN contracts.contratos c ON c.id = s.contrato_id AND c.tenant_id = s.tenant_id
    LEFT JOIN crm.clientes cli ON cli.id = s.cliente_id AND cli.tenant_id = s.tenant_id
    LEFT JOIN crm.clientes cli_contrato ON cli_contrato.id = c.cliente_id AND cli_contrato.tenant_id = s.tenant_id
    LEFT JOIN people.colaboradores col ON col.user_id = s.solicitante_user_id AND col.tenant_id = s.tenant_id
    LEFT JOIN people.areas ar ON ar.id = s.centro_custo_id AND ar.tenant_id = s.tenant_id
    LEFT JOIN people.colaboradores resp ON resp.id = s.responsavel_vlma_id AND resp.tenant_id = s.tenant_id
    LEFT JOIN people.colaboradores dest ON dest.user_id = s.destinatario_user_id AND dest.tenant_id = s.tenant_id
    WHERE s.tenant_id = v_tenant_id
      AND (v_is_manager OR s.solicitante_user_id = p_user_id)
      AND (NOT p_only_unread OR s.lido_at IS NULL)
  ), '[]'::jsonb);
END;
$function$;

-- "Providenciado": o pedido foi resolvido sem virar contrato (ex.: era duvida,
-- ou o contrato ja existia). Sai da fila sem inventar um contrato vazio.
CREATE OR REPLACE FUNCTION public.marcar_solicitacao_providenciada(
  p_user_id uuid, p_solicitacao_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'contracts', 'core'
AS $function$
DECLARE v_tenant_id uuid;
BEGIN
  p_user_id := COALESCE(auth.uid(), p_user_id);
  SELECT tu.tenant_id INTO v_tenant_id FROM core.tenant_users tu
   WHERE tu.user_id = p_user_id AND tu.status = 'ativo' LIMIT 1;
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM contracts.solicitacoes_contrato s
     WHERE s.id = p_solicitacao_id AND s.tenant_id = v_tenant_id
  ) THEN
    RAISE EXCEPTION 'Solicitação não encontrada';
  END IF;

  UPDATE contracts.solicitacoes_contrato SET
    status = 'concluida',
    providenciada_em = COALESCE(providenciada_em, now()),
    providenciada_por = COALESCE(providenciada_por, p_user_id),
    lido_at = COALESCE(lido_at, now()),
    updated_at = now(), updated_by = p_user_id
  WHERE id = p_solicitacao_id AND tenant_id = v_tenant_id;

  RETURN jsonb_build_object('id', p_solicitacao_id);
END;
$function$;
