-- Daily 05/05 (Filipe WhatsApp 15:57 BRT): "a lista de clientes ficou
-- muito comprida e ele não tá localizando clientes depois do O".
-- Edge get-clientes retorna max 1000 itens (hard cap, ignora params).
-- Após import dos 358 novos, total > 1000 e listing trunca antes de "Z".
--
-- Solução: RPC SECURITY DEFINER que retorna lista completa + filtro
-- por busca server-side. Frontend chama via supabase.rpc(),
-- bypassando a edge (mesmo padrão de F-fix list_mensagens_avulsas_inbox
-- e create_mensagem_avulsa).
--
-- Migration 100% aditiva: CREATE OR REPLACE FUNCTION + GRANT EXECUTE.
-- Não mexe na edge get-clientes (consumida por CSV upload e outras telas).

CREATE OR REPLACE FUNCTION public.list_clientes_paginated(
  p_user_id uuid,
  p_limit int DEFAULT 5000,
  p_offset int DEFAULT 0,
  p_search text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'core', 'crm', 'people'
AS $function$
DECLARE
  v_tenant_id uuid;
  v_data jsonb;
  v_total bigint;
  v_search text;
BEGIN
  -- tenant a partir de tenant_users (mesmo padrão de list_mensagens_avulsas_inbox)
  SELECT tu.tenant_id INTO v_tenant_id
  FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id AND tu.status = 'ativo'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não associado a tenant';
  END IF;

  -- NULL ou string vazia/whitespace = sem filtro
  v_search := NULLIF(TRIM(p_search), '');

  -- Total (ignora paginação) para o frontend mostrar contador
  SELECT COUNT(*) INTO v_total
  FROM crm.clientes c
  WHERE c.tenant_id = v_tenant_id
    AND (
      v_search IS NULL
      OR c.nome ILIKE '%' || v_search || '%'
      OR c.cnpj ILIKE '%' || v_search || '%'
    );

  -- Página de dados
  SELECT COALESCE(jsonb_agg(row_data ORDER BY ord_nome), '[]'::jsonb)
  INTO v_data
  FROM (
    SELECT
      jsonb_build_object(
        'id', c.id,
        'nome', c.nome,
        'cnpj', c.cnpj,
        'tipo', c.tipo,
        'cliente_estrangeiro', c.cliente_estrangeiro,
        'grupo_economico_id', c.grupo_economico_id,
        'ativo', c.ativo,
        'created_at', c.created_at
      ) AS row_data,
      c.nome AS ord_nome
    FROM crm.clientes c
    WHERE c.tenant_id = v_tenant_id
      AND (
        v_search IS NULL
        OR c.nome ILIKE '%' || v_search || '%'
        OR c.cnpj ILIKE '%' || v_search || '%'
      )
    ORDER BY c.nome
    LIMIT p_limit OFFSET p_offset
  ) sub;

  RETURN jsonb_build_object(
    'data', v_data,
    'total', v_total,
    'limit', p_limit,
    'offset', p_offset
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.list_clientes_paginated(uuid, int, int, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_clientes_paginated(uuid, int, int, text) TO service_role;
