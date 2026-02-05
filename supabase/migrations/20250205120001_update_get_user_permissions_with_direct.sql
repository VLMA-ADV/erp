-- Migration: Update get_user_permissions to include direct user permissions
-- Agora retorna permissões de roles (UNION) com permissões diretas do usuário

CREATE OR REPLACE FUNCTION public.get_user_permissions(p_user_id uuid)
RETURNS TABLE(permission_key character varying)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'core', 'people'
AS $$
DECLARE
  v_tenant_id UUID;
  v_categoria people.colaborador_categoria;
BEGIN
  -- Buscar tenant do usuário
  SELECT tenant_id INTO v_tenant_id
  FROM core.tenant_users
  WHERE user_id = p_user_id
    AND status = 'ativo'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RETURN;
  END IF;

  -- Buscar categoria do colaborador
  SELECT c.categoria INTO v_categoria
  FROM people.colaboradores c
  WHERE c.user_id = p_user_id
    AND c.tenant_id = v_tenant_id
  LIMIT 1;

  -- Se categoria for 'socio' ou 'administrativo', retornar todas as permissões
  IF v_categoria IN ('socio', 'administrativo') THEN
    RETURN QUERY
    SELECT DISTINCT p.chave::VARCHAR
    FROM core.permissions p
    WHERE p.tenant_id = v_tenant_id
    ORDER BY p.chave;
    RETURN;
  END IF;

  -- Retornar permissões de roles E permissões diretas (UNION DISTINCT)
  RETURN QUERY
  SELECT DISTINCT p.chave::VARCHAR
  FROM (
    -- Permissões de roles
    SELECT DISTINCT p.chave
    FROM core.user_roles ur
    JOIN core.role_permissions rp ON ur.role_id = rp.role_id
    JOIN core.permissions p ON rp.permission_id = p.id
    WHERE ur.user_id = p_user_id
      AND ur.tenant_id = v_tenant_id
      AND p.tenant_id = v_tenant_id
    
    UNION
    
    -- Permissões diretas do usuário
    SELECT DISTINCT p.chave
    FROM core.user_permissions up
    JOIN core.permissions p ON up.permission_id = p.id
    WHERE up.user_id = p_user_id
      AND up.tenant_id = v_tenant_id
      AND p.tenant_id = v_tenant_id
  ) p
  ORDER BY p.chave;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_user_permissions(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_permissions(UUID) TO service_role;
