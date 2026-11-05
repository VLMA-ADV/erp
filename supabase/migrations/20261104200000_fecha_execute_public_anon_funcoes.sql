-- Pentest VLMA-ERP-003: 40 funções de public (e outras em finance, contracts,
-- operations e ops) estavam executáveis sem login. O Postgres dá EXECUTE a
-- PUBLIC em toda função nova, e o ALTER DEFAULT PRIVILEGES ... IN SCHEMA de
-- 20260723140000 não remove esse padrão, que é global. Funções criadas depois
-- de julho voltaram a nascer abertas.
--
-- Não muda o que authenticated e service_role já executam. A verificação de
-- identidade dentro das funções é outra etapa.

DO $$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS assinatura
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('public','finance','contracts','people','operations','ops','core')
      AND p.prokind IN ('f','p')
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
      AND has_function_privilege('anon', p.oid, 'EXECUTE')
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', f.assinatura);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', f.assinatura);
  END LOOP;
END $$;

-- Sem IN SCHEMA: é a única forma de tirar o padrão embutido de PUBLIC.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- Funções novas seguem executáveis por quem já executava, menos anon.
DO $$
DECLARE s text;
BEGIN
  FOREACH s IN ARRAY ARRAY['public','finance','contracts','people','operations','ops','core'] LOOP
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA %I GRANT EXECUTE ON FUNCTIONS TO authenticated, service_role', s);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA %I REVOKE EXECUTE ON FUNCTIONS FROM anon', s);
  END LOOP;
END $$;
