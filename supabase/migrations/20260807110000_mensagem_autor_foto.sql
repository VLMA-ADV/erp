CREATE OR REPLACE FUNCTION public.list_mensagens_avulsas_inbox(p_user_id uuid, p_limit integer DEFAULT 5, p_only_unread boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'core', 'contracts', 'crm', 'people'
AS $function$
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
        -- Foto de quem escreveu: o Filipe pediu que a caixa de entrada pareca
        -- um chat, e chat sem rosto nao parece chat (07/08).
        'autor_foto', col.foto_url,
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
$function$;
