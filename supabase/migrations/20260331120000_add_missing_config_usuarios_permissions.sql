-- Migration: Add missing config.usuarios permissions
-- Bug fix: menu item "Usuários" em Configuração não aparecia porque
-- as permission keys config.usuarios.read/write não existiam na tabela core.permissions.
-- A migration 20250205120006 criou as demais config.* mas omitiu estas duas.

INSERT INTO core.permissions (tenant_id, chave, descricao, categoria)
SELECT t.id, 'config.usuarios.read', 'Visualizar e gerenciar usuários', 'config'
FROM core.tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM core.permissions p WHERE p.tenant_id = t.id AND p.chave = 'config.usuarios.read'
);

INSERT INTO core.permissions (tenant_id, chave, descricao, categoria)
SELECT t.id, 'config.usuarios.write', 'Criar/editar usuários', 'config'
FROM core.tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM core.permissions p WHERE p.tenant_id = t.id AND p.chave = 'config.usuarios.write'
);
