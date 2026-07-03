-- Remove overloads antigos de create_prestador/update_prestador (sem p_resp_cpf).
-- A edge function envia o conjunto completo de params (responsável + endereço),
-- que casa só com a assinatura mais nova. As antigas são cruft e risco de ambiguidade futura.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname IN ('create_prestador','update_prestador')
      AND pg_get_function_identity_arguments(p.oid) NOT LIKE '%p_resp_cpf%'
  LOOP
    EXECUTE format('DROP FUNCTION %I.%I(%s)', r.nspname, r.proname, r.args);
  END LOOP;
END $$;
