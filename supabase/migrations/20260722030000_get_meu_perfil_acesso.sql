-- RPC de apoio para o front decidir visibilidade de módulos.
-- Retorna a categoria e a flag de coordenador do colaborador logado.
-- O front usa isso para o gate de menu: CRM/Contratos/etc. só aparecem para
-- sócio ou coordenador; os demais veem apenas Clientes, Timesheet e Despesas.
-- (people não é exposto no PostgREST runtime, por isso vai por RPC em public.)

CREATE OR REPLACE FUNCTION public.get_meu_perfil_acesso(p_user_id uuid)
RETURNS TABLE(categoria text, eh_coordenador boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'core', 'people'
AS $function$
DECLARE
  v_tenant_id uuid;
BEGIN
  SELECT tu.tenant_id INTO v_tenant_id
  FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id
    AND tu.status = 'ativo'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT c.categoria::text, COALESCE(c.eh_coordenador, false)
  FROM people.colaboradores c
  WHERE c.user_id = p_user_id
    AND c.tenant_id = v_tenant_id
  LIMIT 1;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_meu_perfil_acesso(uuid) TO authenticated;
