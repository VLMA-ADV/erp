-- =====================================================================
-- Ativar contratos "em validação" (respostas ao questionário de out/2026)
--
-- O cliente respondeu:
--   * os contratos parados em validação podem ser ativados todos de uma vez,
--     depois de revisar a lista;
--   * qualquer pessoa pode ativar.
--
-- Até aqui ativar era só pela edge toggle-contrato-status, que exige
-- contracts.contratos.write e chama toggle_contrato_status um contrato por vez.
--
-- Esta função faz o MESMO que toggle_contrato_status faz ao ativar (status,
-- updated_at, updated_by — nada além disso), para uma lista de contratos, e só
-- na transição em validação -> ativo:
--   * em validação no banco é 'em_analise' (a tela mostra "validação");
--   * basta ter acesso de leitura a Contratos (contracts.contratos.read) — quem
--     enxerga a lista pode ativar o que está em validação;
--   * encerrar, reativar um encerrado e mover rascunho continuam exigindo
--     contracts.contratos.write, pela edge, como antes. Esta função não mexe em
--     contrato que não esteja em validação: devolve-o em "ignorados".
--
-- O audit log continua sendo gravado pela edge, por contrato ativado, como já
-- acontece no ativar individual.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.ativar_contratos(p_user_id uuid, p_contrato_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'core', 'contracts'
AS $function$
DECLARE
  v_tenant_id uuid;
  v_ids uuid[];
  v_ativados uuid[];
BEGIN
  -- Em chamada autenticada vale a identidade do token (como get_user_permissions).
  p_user_id := COALESCE(auth.uid(), p_user_id);

  SELECT tenant_id INTO v_tenant_id
  FROM core.tenant_users
  WHERE user_id = p_user_id AND status = 'ativo'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não associado a tenant';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.get_user_permissions(p_user_id) p
    WHERE p.permission_key IN (
      'contracts.contratos.read', 'contracts.contratos.write',
      'contracts.contratos.*', 'contracts.*', '*'
    )
  ) THEN
    RAISE EXCEPTION 'Você não tem permissão para ativar contratos';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT x), '{}') INTO v_ids
  FROM unnest(COALESCE(p_contrato_ids, '{}')) AS x
  WHERE x IS NOT NULL;

  IF cardinality(v_ids) = 0 THEN
    RAISE EXCEPTION 'Nenhum contrato informado';
  END IF;

  IF cardinality(v_ids) > 1000 THEN
    RAISE EXCEPTION 'Selecione no máximo 1000 contratos por vez';
  END IF;

  WITH upd AS (
    UPDATE contracts.contratos c
    SET
      status = 'ativo',
      updated_at = now(),
      updated_by = p_user_id
    WHERE c.id = ANY (v_ids)
      AND c.tenant_id = v_tenant_id
      AND c.status = 'em_analise'
    RETURNING c.id
  )
  SELECT COALESCE(array_agg(id), '{}') INTO v_ativados FROM upd;

  RETURN jsonb_build_object(
    'tenant_id', v_tenant_id,
    'ativados', to_jsonb(v_ativados),
    'ignorados', to_jsonb(ARRAY(SELECT x FROM unnest(v_ids) x WHERE x <> ALL (v_ativados)))
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.ativar_contratos(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ativar_contratos(uuid, uuid[]) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
