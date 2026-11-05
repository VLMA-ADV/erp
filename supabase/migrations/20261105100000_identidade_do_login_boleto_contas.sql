-- Pentest VLMA-ERP-003, usuário logado: estas funções confiavam no p_user_id do
-- parâmetro, então um funcionário podia passar o id de um sócio e herdar as
-- permissões dele. Agora quem está logado age sempre como ele mesmo.
-- Chamada com chave de serviço não tem auth.uid() e continua usando o parâmetro.

DO $$
DECLARE
  f text;
  def text;
  novo text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'bol_config_get','bol_config_upsert','bol_da_nota','bol_do_lancamento','bol_ficha',
    'bol_lancamento_da_nota','bol_listar','bol_preparar',
    'cp_criar_lancamento','cp_dar_baixa','cp_editar_lancamento','cp_excluir_lancamento',
    'cp_fluxo_mensal','cp_get_lancamento','cp_listas','cp_reagendar','cp_receita_prevista',
    'cp_rotina_diaria','cp_set_saldo_conta','cp_sync_faturamento'
  ] LOOP
    SELECT pg_get_functiondef(p.oid) INTO STRICT def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = f;

    IF def !~ 'p_user_id := COALESCE\(auth\.uid\(\), p_user_id\)' THEN
      novo := regexp_replace(def, '\mBEGIN\M', E'BEGIN\n  p_user_id := COALESCE(auth.uid(), p_user_id);');
      IF novo = def THEN RAISE EXCEPTION 'BEGIN não encontrado em %', f; END IF;
      EXECUTE novo;
    END IF;
  END LOOP;
END $$;
