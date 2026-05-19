-- RPC auxiliar para que edges resolvam tenant_id via public schema
-- sem precisar de acesso direto a core.tenant_users via PostgREST
CREATE OR REPLACE FUNCTION public.get_tenant_for_user(p_user_id uuid)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT tenant_id
  FROM core.tenant_users
  WHERE user_id = p_user_id
    AND status = 'ativo'
  LIMIT 1;
$$;
