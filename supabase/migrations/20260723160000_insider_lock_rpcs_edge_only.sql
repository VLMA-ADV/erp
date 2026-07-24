-- FASE 2 (insider) — Frente A: tranca as RPCs sensíveis que SÓ os edges usam.
--
-- Contexto: as RPCs confiam no p_user_id/p_tenant_id do parâmetro (a autz vive nos
-- edges). Um usuário LOGADO (role authenticated) podia chamar a RPC direto no
-- PostgREST com o JWT dele, passar o id de um sócio/tenant e ler folha/PII ou
-- escalar privilégio — contornando o edge. O revoke do anon (migration anterior)
-- fechou o não-logado; falta o logado.
--
-- Estas 21 funções NÃO são chamadas pelo front (nem em componentes, nem em rotas
-- Next — verificado por grep). Só os edge functions (service_role) as chamam. Logo,
-- remover EXECUTE de authenticated as torna acessíveis SOMENTE via edge, que faz a
-- verificação de capacidade. Zero impacto no front.
--
-- (As RPCs que o front chama direto e recebem p_user_id — get_user_permissions,
--  get_minhas_horas_resumo — ficam para um follow-up com guard auth.uid(), pois
--  precisam continuar executáveis por authenticated.)
--
-- Reversível: GRANT EXECUTE ON FUNCTION <assinatura> TO authenticated;

DO $$
DECLARE
  fn text;
  r record;
  alvos text[] := ARRAY[
    'list_colaboradores','get_colaborador','get_colaborador_complete',
    'get_colaboradores_dashboard','create_colaborador','update_colaborador_data',
    'update_colaborador_beneficios','get_colaborador_beneficios',
    'update_user_permissions','update_user_roles','get_user_roles_by_colaborador_id',
    'create_tenant_user','update_tenant_user_status','update_salario_minimo',
    'get_colaborador_permissions','get_meu_perfil_acesso','get_despesa_arquivo',
    'set_colaborador_coordenador','upsert_colaborador_skills_catalog',
    'create_cliente','update_cliente'
  ];
BEGIN
  FOREACH fn IN ARRAY alvos LOOP
    FOR r IN
      SELECT p.oid::regprocedure AS sig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = fn
    LOOP
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM authenticated', r.sig);
      -- garante que anon segue sem acesso (idempotente) e service_role mantém
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', r.sig);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
    END LOOP;
  END LOOP;
END $$;
