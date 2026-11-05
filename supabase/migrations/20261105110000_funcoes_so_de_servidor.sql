-- Aplicar só depois de publicar as rotas /api/boletos, que passam a chamar
-- bol_registrar com a chave de serviço.
--
-- Nenhuma destas tem checagem de permissão e nenhuma é chamada pelo navegador:
-- saem do alcance do usuário logado.
--   bol_registrar: regravava linha digitável e Pix de qualquer boleto
--   bol_pendentes_para_consulta: devolvia beneficiário e valores sem identidade
--   bol_devolver_itens_da_nota: só a edge cancelar-nfse
--   cp_gerar_parcelas: chamada por outras funções
--   cp_manter_recorrencias: só o cron; com p_user_id nulo percorre todos os tenants
REVOKE EXECUTE ON FUNCTION public.bol_registrar(uuid, uuid, jsonb, jsonb, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.bol_pendentes_para_consulta(integer) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.bol_devolver_itens_da_nota(uuid, uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.cp_gerar_parcelas(uuid, uuid, integer) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.cp_manter_recorrencias(uuid, integer) FROM authenticated;

-- Boleto já registrado não é regravado: o desfecho só é gravado uma vez.
DO $$
DECLARE def text; novo text;
BEGIN
  def := pg_get_functiondef('public.bol_registrar(uuid, uuid, jsonb, jsonb, text)'::regprocedure);
  novo := replace(def,
    'WHERE b.id = p_boleto_id AND b.tenant_id = v_tenant',
    'WHERE b.id = p_boleto_id AND b.tenant_id = v_tenant AND b.status NOT IN (''registrado'', ''liquidado'')');
  IF novo = def THEN RAISE EXCEPTION 'WHERE de bol_registrar não encontrado'; END IF;
  EXECUTE novo;
END $$;
