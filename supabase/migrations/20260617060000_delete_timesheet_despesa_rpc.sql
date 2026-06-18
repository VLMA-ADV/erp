-- Exclusão de lançamentos de timesheet e despesas via RPC SECURITY DEFINER.
-- O schema `operations` não é exposto ao PostgREST, então o delete precisa
-- rodar dentro do banco (como create/update_*). Resolve o tenant por
-- core.tenant_users e protege lançamentos já aprovados.

CREATE OR REPLACE FUNCTION public.delete_timesheet(p_user_id uuid, p_timesheet_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_tenant_id uuid;
  v_status text;
BEGIN
  SELECT tenant_id INTO v_tenant_id
  FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id AND tu.status = 'ativo'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não associado a tenant';
  END IF;

  SELECT status INTO v_status
  FROM operations.timesheets
  WHERE id = p_timesheet_id AND tenant_id = v_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lançamento não encontrado';
  END IF;

  IF v_status = 'aprovado' THEN
    RAISE EXCEPTION 'Não é possível excluir um lançamento já aprovado. Reabra a revisão antes.';
  END IF;

  DELETE FROM operations.timesheets
  WHERE id = p_timesheet_id AND tenant_id = v_tenant_id;

  RETURN jsonb_build_object('ok', true, 'id', p_timesheet_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_despesa(p_user_id uuid, p_despesa_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_tenant_id uuid;
  v_status text;
BEGIN
  SELECT tenant_id INTO v_tenant_id
  FROM core.tenant_users tu
  WHERE tu.user_id = p_user_id AND tu.status = 'ativo'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não associado a tenant';
  END IF;

  SELECT status INTO v_status
  FROM operations.despesas
  WHERE id = p_despesa_id AND tenant_id = v_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Despesa não encontrada';
  END IF;

  IF v_status = 'aprovado' THEN
    RAISE EXCEPTION 'Não é possível excluir uma despesa já aprovada. Reabra a revisão antes.';
  END IF;

  DELETE FROM operations.despesas
  WHERE id = p_despesa_id AND tenant_id = v_tenant_id;

  RETURN jsonb_build_object('ok', true, 'id', p_despesa_id);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.delete_timesheet(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_despesa(uuid, uuid) TO authenticated, service_role;
