-- Migration: Add performance indexes
-- Índices para otimizar queries frequentes

-- Índices em core.user_roles para queries frequentes
CREATE INDEX IF NOT EXISTS idx_user_roles_tenant_user ON core.user_roles(tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_user_tenant ON core.user_roles(user_id, tenant_id);

-- Índices em core.role_permissions para JOINs
CREATE INDEX IF NOT EXISTS idx_role_permissions_role_tenant ON core.role_permissions(role_id, permission_id);
CREATE INDEX IF NOT EXISTS idx_role_permissions_permission_tenant ON core.role_permissions(permission_id, role_id);

-- Índices em people.colaboradores para busca por tenant
CREATE INDEX IF NOT EXISTS idx_colaboradores_tenant_ativo ON people.colaboradores(tenant_id, ativo) WHERE ativo = true;
CREATE INDEX IF NOT EXISTS idx_colaboradores_tenant_nome ON people.colaboradores(tenant_id, nome);
CREATE INDEX IF NOT EXISTS idx_colaboradores_user_id ON people.colaboradores(user_id);
CREATE INDEX IF NOT EXISTS idx_colaboradores_email ON people.colaboradores(email);

-- Índices em core.permissions para busca por tenant
CREATE INDEX IF NOT EXISTS idx_permissions_tenant_categoria ON core.permissions(tenant_id, categoria);
CREATE INDEX IF NOT EXISTS idx_permissions_tenant_chave ON core.permissions(tenant_id, chave);

-- Índices em core.audit_logs para queries de auditoria
CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_created ON core.audit_logs(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entidade ON core.audit_logs(tipo_entidade, entidade_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON core.audit_logs(user_id, created_at DESC);

-- Índices em people.colaboradores_beneficios
CREATE INDEX IF NOT EXISTS idx_colaboradores_beneficios_colaborador ON people.colaboradores_beneficios(colaborador_id);

-- Comentários
COMMENT ON INDEX idx_user_roles_tenant_user IS 'Índice para busca rápida de roles por tenant e usuário';
COMMENT ON INDEX idx_colaboradores_tenant_ativo IS 'Índice para listagem de colaboradores ativos por tenant';
COMMENT ON INDEX idx_audit_logs_tenant_created IS 'Índice para queries de auditoria ordenadas por data';
