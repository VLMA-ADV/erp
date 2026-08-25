-- =====================================================================
-- Ver as horas de todos: Jessika, sócios e coordenadores
--
-- Filipe, 25/08: "habilitar para Jessika, sócios e coordenadores visualizarem
-- as horas de todos, assim como eu visualizo hoje."
--
-- get_timesheets já tem o caminho de "vê tudo" pela permissão
-- 'operations.timesheet.manage' — mas essa chave NUNCA FOI CRIADA em
-- core.permissions (mesmo bug que 'operations.despesas.manage' tinha antes de
-- 17/08). Então o teste sempre dava falso e o caminho era inalcançável.
--
-- Antes daqui, quem via tudo eram só os sócios de área VLMA (Filipe, Renata,
-- Douglas, Luana). Jessika via só o Financeiro; coordenadores e sócios de área
-- específica viam só a própria área.
--
-- Grant NOMINAL, por core.user_permissions — não mudança de cargo. Concede a
-- quem é sócio OU coordenador ativo, MENOS as contas que estão marcadas como
-- sócio no cadastro mas não são partícipes de fato:
--   - QA VLMA (conta de teste)
--   - recepcao1@ (Mylena, recepção)
--   - flowcode (Lucas, desenvolvimento)
-- Jessika entra por ser coordenadora.
-- =====================================================================

INSERT INTO core.permissions (tenant_id, chave, descricao)
SELECT DISTINCT t.tenant_id, 'operations.timesheet.manage',
       'Ver e gerir os lançamentos de horas de todos os colaboradores'
FROM core.tenant_users t
WHERE t.tenant_id = 'd51463dd-a6b3-40e7-9488-854eba80a210'
  AND NOT EXISTS (
    SELECT 1 FROM core.permissions p
    WHERE p.tenant_id = t.tenant_id AND p.chave = 'operations.timesheet.manage'
  );

INSERT INTO core.user_permissions (tenant_id, user_id, permission_id)
SELECT c.tenant_id, c.user_id, p.id
FROM people.colaboradores c
JOIN auth.users u ON u.id = c.user_id
JOIN core.permissions p
  ON p.tenant_id = c.tenant_id AND p.chave = 'operations.timesheet.manage'
WHERE c.tenant_id = 'd51463dd-a6b3-40e7-9488-854eba80a210'
  AND c.ativo = true
  AND c.user_id IS NOT NULL
  AND (c.categoria = 'socio' OR c.eh_coordenador = true)
  AND u.email NOT IN (
    'qa.vlma.teste@local.dev',
    'recepcao1@vlma.com.br',
    'lucas.carmo@flowcode.cc'
  )
  AND NOT EXISTS (
    SELECT 1 FROM core.user_permissions up
    WHERE up.tenant_id = c.tenant_id AND up.user_id = c.user_id AND up.permission_id = p.id
  );
