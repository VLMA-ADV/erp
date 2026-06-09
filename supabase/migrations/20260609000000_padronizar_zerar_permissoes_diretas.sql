-- Padronização de permissões (daily Filipe 09/06, fase de testes).
--
-- Contexto: "muita gente vendo info de outras áreas". A função get_user_permissions
-- já dá tudo para categoria socio/administrativo (correto). O vazamento dos
-- não-sócios vem de 822 permissões DIRETAS (core.user_permissions) concedidas
-- pessoa-a-pessoa ao longo de meses (722 pelo próprio Filipe), somadas por cima
-- das roles. Esta migration zera as diretas para o acesso voltar a ser
-- determinístico pela role/categoria.
--
-- As roles 'advogado' e 'estagiario' são ajustadas para "só operações + home"
-- pela TELA (/configuracao/roles), não aqui.
--
-- Backup automático em core.user_permissions_bkp_20260609 (reversível):
--   INSERT INTO core.user_permissions SELECT * FROM core.user_permissions_bkp_20260609;

CREATE TABLE IF NOT EXISTS core.user_permissions_bkp_20260609 AS
SELECT * FROM core.user_permissions;

DELETE FROM core.user_permissions;
