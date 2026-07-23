-- CRÍTICO (LGPD): funções SECURITY DEFINER estavam com EXECUTE para PUBLIC/anon.
-- Como as RPCs confiam no p_user_id/p_tenant_id passado pelo chamador (a auth vive
-- nos edge functions), qualquer anônimo com a anon key (que é pública, vai no bundle)
-- podia chamar a RPC direto no PostgREST e contornar TODOS os gates — ex.:
-- list_colaboradores(tenant_id) devolvia a folha de pagamento inteira sem login.
--
-- Fix emergencial: remove EXECUTE de PUBLIC e de anon em todas as funções dos
-- schemas de negócio, PRESERVANDO authenticated (front) e service_role (edges) via
-- grant explícito. Fecha o buraco da internet sem quebrar nada logado.
--
-- NÃO resolve o bypass de INSIDER (usuário logado ainda executa RPC que confia em
-- p_user_id) — isso é a fase 2 (mover p/ auth.uid() ou restringir a service_role).
--
-- Reversível: GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA <s> TO anon;

DO $$
DECLARE s text;
BEGIN
  FOREACH s IN ARRAY ARRAY['public','finance','contracts','people','operations','core'] LOOP
    EXECUTE format('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA %I TO authenticated, service_role', s);
    EXECUTE format('REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA %I FROM PUBLIC', s);
    EXECUTE format('REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA %I FROM anon', s);
  END LOOP;
END $$;

-- Impede que novas funções voltem a nascer com EXECUTE para anon/PUBLIC.
DO $$
DECLARE s text;
BEGIN
  FOREACH s IN ARRAY ARRAY['public','finance','contracts','people','operations','core'] LOOP
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC', s);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I REVOKE EXECUTE ON FUNCTIONS FROM anon', s);
  END LOOP;
END $$;
