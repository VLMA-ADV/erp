-- Item 7 daily 2026-05-07: check de leitura em Solicitações de Contrato + Mensagens avulsas.
-- Adiciona coluna lido_at em ambas as tabelas, RPCs mark_*_as_read SECURITY DEFINER,
-- e p_only_unread DEFAULT false em get_solicitacoes_contrato + list_mensagens_avulsas_inbox
-- (backward-compat: callers existentes que passam só p_user_id continuam funcionando).

ALTER TABLE contracts.solicitacoes_contrato ADD COLUMN IF NOT EXISTS lido_at timestamptz;
ALTER TABLE contracts.solicitacao_mensagens ADD COLUMN IF NOT EXISTS lido_at timestamptz;

CREATE OR REPLACE FUNCTION public.mark_solicitacao_as_read(
  p_user_id uuid,
  p_solicitacao_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'core', 'contracts'
AS $$
DECLARE
  v_tenant_id uuid;
BEGIN
  SELECT tu.tenant_id INTO v_tenant_id
  FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id AND tu.status = 'ativo'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Usuario nao associado a tenant';
  END IF;

  UPDATE contracts.solicitacoes_contrato
  SET lido_at = COALESCE(lido_at, now()),
      updated_by = p_user_id,
      updated_at = now()
  WHERE id = p_solicitacao_id
    AND tenant_id = v_tenant_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_mensagem_as_read(
  p_user_id uuid,
  p_mensagem_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'core', 'contracts'
AS $$
DECLARE
  v_tenant_id uuid;
BEGIN
  SELECT tu.tenant_id INTO v_tenant_id
  FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id AND tu.status = 'ativo'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Usuario nao associado a tenant';
  END IF;

  UPDATE contracts.solicitacao_mensagens
  SET lido_at = COALESCE(lido_at, now())
  WHERE id = p_mensagem_id
    AND tenant_id = v_tenant_id;
END;
$$;

DROP FUNCTION IF EXISTS public.get_solicitacoes_contrato(uuid);
DROP FUNCTION IF EXISTS public.list_mensagens_avulsas_inbox(uuid, integer);

CREATE OR REPLACE FUNCTION public.get_solicitacoes_contrato(
  p_user_id uuid,
  p_only_unread boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
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
        'contrato_nome', c.nome_contrato,
        'solicitante_user_id', s.solicitante_user_id,
        'solicitante_nome', col.nome,
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
    WHERE s.tenant_id = v_tenant_id
      AND (v_is_manager OR s.solicitante_user_id = p_user_id)
      AND (NOT p_only_unread OR s.lido_at IS NULL)
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.list_mensagens_avulsas_inbox(
  p_user_id uuid,
  p_limit integer DEFAULT 5,
  p_only_unread boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'core', 'contracts', 'crm', 'people'
AS $$
DECLARE
  v_tenant_id uuid;
  v_result jsonb;
BEGIN
  SELECT tu.tenant_id INTO v_tenant_id
  FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id AND tu.status = 'ativo'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Usuario nao associado a tenant';
  END IF;

  SELECT COALESCE(jsonb_agg(row_data ORDER BY created_at DESC), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT
      jsonb_build_object(
        'id', m.id,
        'mensagem', m.mensagem,
        'created_at', m.created_at,
        'cliente_id', m.cliente_id,
        'caso_id', m.caso_id,
        'autor_id', m.autor_id,
        'cliente_nome', cl.nome,
        'caso_nome', cs.nome,
        'autor_nome', col.nome,
        'lido_at', m.lido_at
      ) AS row_data,
      m.created_at
    FROM contracts.solicitacao_mensagens m
    LEFT JOIN crm.clientes cl ON cl.id = m.cliente_id
    LEFT JOIN contracts.casos cs ON cs.id = m.caso_id
    LEFT JOIN people.colaboradores col ON col.id = m.autor_id
    WHERE m.tenant_id = v_tenant_id
      AND m.solicitacao_id IS NULL
      AND (NOT p_only_unread OR m.lido_at IS NULL)
    ORDER BY m.created_at DESC
    LIMIT p_limit
  ) sub;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_solicitacao_as_read(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_mensagem_as_read(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_solicitacoes_contrato(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_mensagens_avulsas_inbox(uuid, integer, boolean) TO authenticated;
