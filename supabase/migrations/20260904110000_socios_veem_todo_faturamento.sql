-- =====================================================================
-- Todo socio ve o faturamento do escritorio inteiro
--
-- Em 03/09 a Bruna Bogucheski recebeu 'finance.faturamento.ver_todos' de forma
-- nominal (20260903210000). Em 04/09 o Filipe pediu o mesmo para todos os
-- socios: "liberar para todos os socios o que liberamos para a Bruna".
--
-- Mesmo mecanismo da Bruna, de proposito: concessao NOMINAL em
-- core.user_permissions, que e o que get_revisao_fatura le. Nao mexe na
-- funcao nem na regra por area — quem nao e socio continua escopado pelo
-- centro de custo. Socio que entrar depois precisa da mesma concessao
-- (pela tela de permissoes ou por outra migracao).
--
-- Quem ganha de fato: Leonardo (Tributario), Mariana (Agro), Tiago e Victor
-- (Societario). Os demais socios ja viam tudo por serem da area VLMA ou
-- Financeiro; a linha entra para eles tambem, para a regra ficar uniforme.
-- =====================================================================

INSERT INTO core.user_permissions (tenant_id, user_id, permission_id)
SELECT c.tenant_id, c.user_id, p.id
FROM people.colaboradores c
JOIN auth.users u ON u.id = c.user_id
JOIN core.permissions p ON p.tenant_id = c.tenant_id AND p.chave = 'finance.faturamento.ver_todos'
WHERE c.tenant_id = 'd51463dd-a6b3-40e7-9488-854eba80a210'
  AND c.categoria = 'socio'
  AND c.ativo
  AND NOT EXISTS (SELECT 1 FROM core.user_permissions up
                   WHERE up.tenant_id = c.tenant_id AND up.user_id = c.user_id AND up.permission_id = p.id);
