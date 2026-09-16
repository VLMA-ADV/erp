-- =====================================================================
-- Lista os anexos (comprovantes) de um conjunto de despesas
--
-- Filipe, 11/09: "incluir uma forma de trazer os arquivos das despesas junto
-- com a nota de debito (um consolidador de arquivos pdf talvez)?" —
-- confirmado em 16/09 como PDF unico.
--
-- Devolve so o CATALOGO (id, nome, tipo, tamanho), sem o binario: quem baixa
-- arquivo por arquivo e a edge get-despesa-arquivo, que ja existe e ja checa
-- permissao. Assim a tela sabe quantos e quais arquivos vai juntar antes de
-- comecar, e consegue avisar o que nao da para anexar (HTML, por exemplo).
-- =====================================================================
CREATE OR REPLACE FUNCTION public.get_anexos_das_despesas(p_user_id uuid, p_despesa_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'operations', 'core'
AS $$
DECLARE v_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_tenant FROM core.tenant_users
   WHERE user_id = p_user_id AND status = 'ativo' LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem tenant'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.get_user_permissions(p_user_id) p
    WHERE p.permission_key IN ('finance.faturamento.read', 'finance.faturamento.manage',
                               'expenses.read', 'finance.*', '*')
  ) THEN
    RAISE EXCEPTION 'Sem permissão para ver comprovantes de despesa';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(to_jsonb(x) ORDER BY x.ordem, x.arquivo_nome)
    FROM (
      SELECT d.id AS despesa_id, 'primario'::text AS kind, d.id AS anexo_id,
             d.arquivo_nome, NULL::text AS mime_type, 1 AS ordem
      FROM operations.despesas d
      WHERE d.tenant_id = v_tenant AND d.id = ANY(p_despesa_ids)
        AND d.arquivo IS NOT NULL AND COALESCE(d.arquivo_nome, '') <> ''
      UNION ALL
      SELECT a.despesa_id, 'extra'::text, a.id, a.arquivo_nome, a.mime_type, 2
      FROM operations.despesa_anexos a
      JOIN operations.despesas d ON d.id = a.despesa_id AND d.tenant_id = v_tenant
      WHERE a.despesa_id = ANY(p_despesa_ids) AND a.arquivo IS NOT NULL
    ) x
  ), '[]'::jsonb);
END $$;

REVOKE ALL ON FUNCTION public.get_anexos_das_despesas(uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_anexos_das_despesas(uuid, uuid[]) TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';
