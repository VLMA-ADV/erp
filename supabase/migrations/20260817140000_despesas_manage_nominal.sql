-- =====================================================================
-- Ver as despesas de todos: Jessika, Aline e Thais
--
-- Filipe/Lucas, 17/08: "permitir que eu, jessika, aline e thais possam
-- visualizar as despesas de todos".
--
-- get_despesas já tem o caminho de "vê tudo": categoria sócio/administrativo,
-- ou a permissão 'operations.despesas.manage'. Só que essa chave NUNCA FOI
-- CRIADA em core.permissions — existem só 'operations.despesas.read' e
-- '.write'. Ou seja, o teste sempre deu falso e o caminho era inalcançável
-- para quem não fosse sócio ou administrativo.
--
-- Situação antes daqui:
--   Lucas    — sócio          => já via tudo
--   Jessika  — administrativo => já via tudo
--   Aline    — advogado       => via só as próprias
--   Thais    — advogado       => via só as próprias
--
-- Então a mudança real é para Aline e Thais. É um grant NOMINAL, por
-- core.user_permissions, e não uma mudança de cargo: dar 'advogado' acesso a
-- tudo faria os outros 30 advogados verem as despesas do escritório inteiro,
-- que não foi o que se pediu.
-- =====================================================================

INSERT INTO core.permissions (tenant_id, chave, descricao)
SELECT DISTINCT t.tenant_id, 'operations.despesas.manage',
       'Ver e gerir as despesas de todos os colaboradores'
FROM core.tenant_users t
WHERE t.tenant_id = 'd51463dd-a6b3-40e7-9488-854eba80a210'
  AND NOT EXISTS (
    SELECT 1 FROM core.permissions p
    WHERE p.tenant_id = t.tenant_id AND p.chave = 'operations.despesas.manage'
  );

INSERT INTO core.user_permissions (tenant_id, user_id, permission_id)
SELECT c.tenant_id, c.user_id, p.id
FROM people.colaboradores c
JOIN core.permissions p
  ON p.tenant_id = c.tenant_id AND p.chave = 'operations.despesas.manage'
WHERE c.tenant_id = 'd51463dd-a6b3-40e7-9488-854eba80a210'
  AND c.user_id IS NOT NULL
  AND (c.nome ILIKE 'Aline Duarte%' OR c.nome ILIKE 'Thais Mara%' OR c.nome ILIKE 'Jessika%')
  AND NOT EXISTS (
    SELECT 1 FROM core.user_permissions up
    WHERE up.tenant_id = c.tenant_id AND up.user_id = c.user_id AND up.permission_id = p.id
  );
