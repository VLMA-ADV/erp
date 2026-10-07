-- "Grupo de impostos escolhido não foi encontrado." ao emitir NFS-e com o
-- regime ajustado no kit (Filipe, 07/10, caso 1839). A edge emit-nfse lia
-- contracts.grupos_impostos pelo PostgREST com a service role, e essa tabela
-- nunca recebeu GRANT para a service role (RLS ligado, sem policy). O mesmo
-- caminho para pagadores ajustados lia crm.clientes, e o schema crm nem é
-- exposto no PostgREST. Ou seja: trocar grupo ou pagador na nota nunca
-- funcionou em produção. Leitura passa a ser por RPC SECURITY DEFINER.
CREATE OR REPLACE FUNCTION public.nfse_grupo_imposto(p_tenant_id uuid, p_grupo_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'contracts', 'public' AS $$
  SELECT to_jsonb(g) FROM contracts.grupos_impostos g WHERE g.id = p_grupo_id AND g.tenant_id = p_tenant_id;
$$;
CREATE OR REPLACE FUNCTION public.nfse_clientes_por_ids(p_tenant_id uuid, p_ids uuid[])
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'crm', 'public' AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(c)), '[]'::jsonb) FROM crm.clientes c WHERE c.tenant_id = p_tenant_id AND c.id = ANY(p_ids);
$$;
REVOKE ALL ON FUNCTION public.nfse_grupo_imposto(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.nfse_clientes_por_ids(uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nfse_grupo_imposto(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.nfse_clientes_por_ids(uuid, uuid[]) TO service_role;
