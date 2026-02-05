-- Migration: Create update_user_permissions RPC function
-- Função para gerenciar permissões diretas do usuário

CREATE OR REPLACE FUNCTION public.update_user_permissions(
  p_user_id uuid, -- Usuário que está fazendo a atualização
  p_colaborador_user_id uuid, -- Usuário do colaborador que terá as permissões atualizadas
  p_tenant_id uuid,
  p_permission_ids uuid[] -- IDs das permissões a serem atribuídas
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'core'
AS $$
BEGIN
  -- Validar que o tenant_id existe
  IF NOT EXISTS (SELECT 1 FROM core.tenants WHERE id = p_tenant_id) THEN
    RAISE EXCEPTION 'Tenant not found';
  END IF;

  -- Validar que o colaborador_user_id pertence ao tenant
  IF NOT EXISTS (
    SELECT 1 
    FROM people.colaboradores c
    WHERE c.user_id = p_colaborador_user_id
      AND c.tenant_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'Colaborador not found or does not belong to the tenant';
  END IF;

  -- Deletar permissões diretas existentes para o usuário
  DELETE FROM core.user_permissions
  WHERE tenant_id = p_tenant_id
    AND user_id = p_colaborador_user_id;

  -- Inserir novas permissões diretas se houver
  IF array_length(p_permission_ids, 1) IS NOT NULL AND array_length(p_permission_ids, 1) > 0 THEN
    INSERT INTO core.user_permissions (tenant_id, user_id, permission_id, created_by)
    SELECT 
      p_tenant_id, 
      p_colaborador_user_id, 
      permission_id, 
      p_user_id
    FROM unnest(p_permission_ids) AS permission_id
    WHERE EXISTS (
      SELECT 1 
      FROM core.permissions p 
      WHERE p.id = permission_id 
        AND p.tenant_id = p_tenant_id
    );
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_user_permissions(UUID, UUID, UUID, UUID[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_user_permissions(UUID, UUID, UUID, UUID[]) TO service_role;

COMMENT ON FUNCTION public.update_user_permissions IS 'Atualiza permissões diretas de um usuário, deletando as existentes e inserindo as novas fornecidas';
