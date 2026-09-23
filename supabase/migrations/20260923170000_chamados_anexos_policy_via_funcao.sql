-- Upload no bucket chamados-anexos voltava 400 em producao (teste 23/09): a
-- policy consultava core.tenant_users direto, e o papel authenticated nao tem
-- USAGE no schema core (mesmo tropeco do F-fix de 05/05). O bucket de
-- faturamento nao sofre disso porque checa por funcao SECURITY DEFINER.
-- Mesma solucao aqui: funcao publica que diz se a pasta raiz e o tenant do
-- usuario logado; as policies passam a chamar so ela.
CREATE OR REPLACE FUNCTION public.pasta_e_do_meu_tenant(p_pasta text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'core'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM core.tenant_users tu
    WHERE tu.user_id = auth.uid()
      AND tu.status = 'ativo'
      AND tu.tenant_id::text = p_pasta
  );
$$;
GRANT EXECUTE ON FUNCTION public.pasta_e_do_meu_tenant(text) TO authenticated, service_role;

DROP POLICY IF EXISTS auth_insert_chamados_anexos ON storage.objects;
DROP POLICY IF EXISTS auth_read_chamados_anexos ON storage.objects;
CREATE POLICY auth_insert_chamados_anexos ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'chamados-anexos' AND public.pasta_e_do_meu_tenant((storage.foldername(name))[1]));
CREATE POLICY auth_read_chamados_anexos ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'chamados-anexos' AND public.pasta_e_do_meu_tenant((storage.foldername(name))[1]));
-- Quem subiu pode remover se a criacao do chamado falhar depois do upload.
CREATE POLICY auth_delete_chamados_anexos ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'chamados-anexos' AND owner = auth.uid() AND public.pasta_e_do_meu_tenant((storage.foldername(name))[1]));
