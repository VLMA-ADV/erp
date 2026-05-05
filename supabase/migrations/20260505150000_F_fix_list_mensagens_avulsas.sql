-- F-fix: card "Mensagens" mostrava "Erro ao carregar" em prod (smoke Playwright 05/05).
--
-- Causa raiz: PR #89 fez SELECT cross-schema via supabase.schema('contracts').from('solicitacao_mensagens')
-- mas a role 'authenticated' (usada pelo client supabase-js) NÃO tem GRANT USAGE no schema contracts.
-- HTTP 403 / 42501 "permission denied for schema contracts".
--
-- Solução: RPC SECURITY DEFINER list_mensagens_avulsas_inbox que faz o SELECT + JOINs
-- internamente (mesma estratégia de create_mensagem_avulsa, que funciona em prod).
-- Mais segura que conceder GRANT USAGE direto no schema (não expõe outras tabelas).
--
-- Migration 100% aditiva: CREATE OR REPLACE FUNCTION + GRANT EXECUTE.

CREATE OR REPLACE FUNCTION public.list_mensagens_avulsas_inbox(
  p_user_id uuid,
  p_limit int DEFAULT 5
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'core', 'contracts', 'crm', 'people'
AS $function$
DECLARE
  v_tenant_id uuid;
  v_result jsonb;
BEGIN
  -- tenant a partir de tenant_users (mesmo padrão de create_mensagem_avulsa)
  SELECT tu.tenant_id INTO v_tenant_id
  FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id AND tu.status = 'ativo'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não associado a tenant';
  END IF;

  -- Mensagens avulsas (solicitacao_id IS NULL) + JOIN cliente/caso/autor
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
        'autor_nome', col.nome
      ) AS row_data,
      m.created_at
    FROM contracts.solicitacao_mensagens m
    LEFT JOIN crm.clientes cl ON cl.id = m.cliente_id
    LEFT JOIN contracts.casos cs ON cs.id = m.caso_id
    LEFT JOIN people.colaboradores col ON col.id = m.autor_id
    WHERE m.tenant_id = v_tenant_id
      AND m.solicitacao_id IS NULL
    ORDER BY m.created_at DESC
    LIMIT p_limit
  ) sub;

  RETURN v_result;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.list_mensagens_avulsas_inbox(uuid, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_mensagens_avulsas_inbox(uuid, int) TO service_role;
