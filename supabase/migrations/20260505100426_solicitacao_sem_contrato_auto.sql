-- Daily Filipe 04/05 (22:03 WhatsApp): solicitação NÃO cria contrato automático.
-- "Pode tirar essa amarra e deixar como se fosse uma mensagem mesmo no inbox ali"
--
-- Replace de public.create_solicitacao_contrato:
--   * REMOVE: INSERT em contracts.contratos (rascunho automático)
--   * REMOVE: espelhamento de anexos para contracts.contrato_anexos
--   * MANTÉM: insert em contracts.solicitacoes_contrato com contrato_id NULL
--   * MANTÉM: insert em contracts.solicitacoes_contrato_anexos
--   * RETORNO: { id, contrato_id: null }  (frontend só consome id; contrato_id já era opcional)
--
-- Backward-compatible: solicitações antigas com contrato_id permanecem intactas.
-- Edge create-solicitacao-contrato continua publicada com fallback defensivo
-- (criaria contrato manual se RPC retornasse sem contrato_id), mas o frontend
-- foi refatorado para chamar a RPC direto via supabase-js, bypassando o edge.

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
    centro_custo_id
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
    v_centro_custo_id
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

  RETURN jsonb_build_object('id', v_id, 'contrato_id', NULL);
END;
$function$;
