-- Migration: Create user_permissions table
-- Permite vincular permissões diretamente aos usuários, além das permissões herdadas de roles

CREATE TABLE IF NOT EXISTS core.user_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES core.tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES core.permissions(id) ON DELETE CASCADE,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Garantir que a combinação seja única
  CONSTRAINT user_permissions_unique UNIQUE (tenant_id, user_id, permission_id)
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_user_permissions_tenant_user ON core.user_permissions(tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_user_permissions_user ON core.user_permissions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_permissions_permission ON core.user_permissions(permission_id);
CREATE INDEX IF NOT EXISTS idx_user_permissions_tenant ON core.user_permissions(tenant_id);

-- Comentários
COMMENT ON TABLE core.user_permissions IS 'Permissões atribuídas diretamente aos usuários, além das permissões herdadas das roles';
COMMENT ON COLUMN core.user_permissions.tenant_id IS 'Tenant do usuário';
COMMENT ON COLUMN core.user_permissions.user_id IS 'Usuário que recebe a permissão';
COMMENT ON COLUMN core.user_permissions.permission_id IS 'Permissão atribuída';
COMMENT ON COLUMN core.user_permissions.created_by IS 'Usuário que atribuiu a permissão';

-- RLS (Row Level Security)
ALTER TABLE core.user_permissions ENABLE ROW LEVEL SECURITY;

-- Política RLS: usuários só podem ver permissões do seu tenant
CREATE POLICY "Users can view user_permissions of their tenant"
  ON core.user_permissions
  FOR SELECT
  USING (
    tenant_id IN (
      SELECT tenant_id 
      FROM core.tenant_users 
      WHERE user_id = auth.uid() 
        AND status = 'ativo'
    )
  );

-- Política RLS: apenas usuários com permissão de gerenciar permissões podem inserir
CREATE POLICY "Users with permission management can insert user_permissions"
  ON core.user_permissions
  FOR INSERT
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id 
      FROM core.tenant_users 
      WHERE user_id = auth.uid() 
        AND status = 'ativo'
    )
  );

-- Política RLS: apenas usuários com permissão de gerenciar permissões podem atualizar
CREATE POLICY "Users with permission management can update user_permissions"
  ON core.user_permissions
  FOR UPDATE
  USING (
    tenant_id IN (
      SELECT tenant_id 
      FROM core.tenant_users 
      WHERE user_id = auth.uid() 
        AND status = 'ativo'
    )
  );

-- Política RLS: apenas usuários com permissão de gerenciar permissões podem deletar
CREATE POLICY "Users with permission management can delete user_permissions"
  ON core.user_permissions
  FOR DELETE
  USING (
    tenant_id IN (
      SELECT tenant_id 
      FROM core.tenant_users 
      WHERE user_id = auth.uid() 
        AND status = 'ativo'
    )
  );
