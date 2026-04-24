-- Migration: Create configuration permissions
-- Cria permissões de configuração para todos os tenants existentes

INSERT INTO core.permissions (tenant_id, chave, descricao, categoria)
SELECT 
  t.id,
  'config.cargos.read',
  'Visualizar cargos',
  'config'
FROM core.tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM core.permissions p 
  WHERE p.tenant_id = t.id AND p.chave = 'config.cargos.read'
);

INSERT INTO core.permissions (tenant_id, chave, descricao, categoria)
SELECT 
  t.id,
  'config.cargos.write',
  'Criar/editar cargos',
  'config'
FROM core.tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM core.permissions p 
  WHERE p.tenant_id = t.id AND p.chave = 'config.cargos.write'
);

INSERT INTO core.permissions (tenant_id, chave, descricao, categoria)
SELECT 
  t.id,
  'config.areas.read',
  'Visualizar áreas',
  'config'
FROM core.tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM core.permissions p 
  WHERE p.tenant_id = t.id AND p.chave = 'config.areas.read'
);

INSERT INTO core.permissions (tenant_id, chave, descricao, categoria)
SELECT 
  t.id,
  'config.areas.write',
  'Criar/editar áreas',
  'config'
FROM core.tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM core.permissions p 
  WHERE p.tenant_id = t.id AND p.chave = 'config.areas.write'
);

INSERT INTO core.permissions (tenant_id, chave, descricao, categoria)
SELECT 
  t.id,
  'config.roles.read',
  'Visualizar roles',
  'config'
FROM core.tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM core.permissions p 
  WHERE p.tenant_id = t.id AND p.chave = 'config.roles.read'
);

INSERT INTO core.permissions (tenant_id, chave, descricao, categoria)
SELECT 
  t.id,
  'config.roles.write',
  'Criar/editar roles',
  'config'
FROM core.tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM core.permissions p 
  WHERE p.tenant_id = t.id AND p.chave = 'config.roles.write'
);

INSERT INTO core.permissions (tenant_id, chave, descricao, categoria)
SELECT 
  t.id,
  'config.permissions.read',
  'Visualizar permissões',
  'config'
FROM core.tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM core.permissions p 
  WHERE p.tenant_id = t.id AND p.chave = 'config.permissions.read'
);

INSERT INTO core.permissions (tenant_id, chave, descricao, categoria)
SELECT 
  t.id,
  'config.segmentos.read',
  'Visualizar segmentos econômicos',
  'config'
FROM core.tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM core.permissions p 
  WHERE p.tenant_id = t.id AND p.chave = 'config.segmentos.read'
);

INSERT INTO core.permissions (tenant_id, chave, descricao, categoria)
SELECT 
  t.id,
  'config.grupos.read',
  'Visualizar grupos econômicos',
  'config'
FROM core.tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM core.permissions p 
  WHERE p.tenant_id = t.id AND p.chave = 'config.grupos.read'
);
