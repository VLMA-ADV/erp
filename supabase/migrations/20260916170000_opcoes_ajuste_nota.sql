-- =====================================================================
-- Listas de apoio do bloco "Ajustes desta nota"
--
-- A previa tentava ler contracts.grupos_impostos e crm.clientes direto pelo
-- PostgREST: crm nao e exposto (406) e grupos_impostos tem RLS (403). Uma
-- funcao SECURITY DEFINER resolve os dois e ainda cobra a mesma permissao da
-- emissao — quem nao pode emitir nao precisa dessas listas.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.get_opcoes_ajuste_nota(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'contracts', 'crm', 'core'
AS $$
DECLARE v_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_tenant FROM core.tenant_users
   WHERE user_id = p_user_id AND status = 'ativo' LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem tenant'; END IF;
  IF NOT public.tem_capacidade_sensivel(p_user_id, 'finance.nfse.manage') THEN
    RAISE EXCEPTION 'Sem permissão para emitir NFS-e';
  END IF;

  RETURN jsonb_build_object(
    'grupos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', g.id, 'nome', g.nome) ORDER BY g.nome)
      FROM contracts.grupos_impostos g WHERE g.tenant_id = v_tenant
    ), '[]'::jsonb),
    'clientes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', c.id, 'nome', c.nome) ORDER BY c.nome)
      FROM crm.clientes c WHERE c.tenant_id = v_tenant
    ), '[]'::jsonb)
  );
END $$;

REVOKE ALL ON FUNCTION public.get_opcoes_ajuste_nota(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_opcoes_ajuste_nota(uuid) TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';
