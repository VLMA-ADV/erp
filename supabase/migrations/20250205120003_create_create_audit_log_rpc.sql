-- Migration: Create create_audit_log RPC function
-- Função padronizada para inserção de audit logs

CREATE OR REPLACE FUNCTION public.create_audit_log(
  p_tenant_id uuid,
  p_tipo_entidade varchar,
  p_entidade_id uuid,
  p_acao varchar, -- 'create', 'update', 'delete'
  p_user_id uuid,
  p_dados_anteriores jsonb DEFAULT NULL,
  p_dados_novos jsonb DEFAULT NULL,
  p_ip_address varchar DEFAULT NULL,
  p_user_agent varchar DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'core'
AS $$
DECLARE
  v_audit_log_id uuid;
BEGIN
  -- Validar que o tenant_id existe
  IF NOT EXISTS (SELECT 1 FROM core.tenants WHERE id = p_tenant_id) THEN
    RAISE EXCEPTION 'Tenant not found';
  END IF;

  -- Validar que o user_id existe
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  -- Validar ação
  IF p_acao NOT IN ('create', 'update', 'delete') THEN
    RAISE EXCEPTION 'Invalid action. Must be create, update, or delete';
  END IF;

  -- Inserir audit log
  INSERT INTO core.audit_logs (
    tenant_id,
    tipo_entidade,
    entidade_id,
    acao,
    user_id,
    dados_anteriores,
    dados_novos,
    ip_address,
    user_agent
  ) VALUES (
    p_tenant_id,
    p_tipo_entidade,
    p_entidade_id,
    p_acao::core.audit_action,
    p_user_id,
    p_dados_anteriores,
    p_dados_novos,
    p_ip_address,
    p_user_agent
  )
  RETURNING id INTO v_audit_log_id;

  RETURN v_audit_log_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_audit_log(UUID, VARCHAR, UUID, VARCHAR, UUID, JSONB, JSONB, VARCHAR, VARCHAR) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_audit_log(UUID, VARCHAR, UUID, VARCHAR, UUID, JSONB, JSONB, VARCHAR, VARCHAR) TO service_role;

COMMENT ON FUNCTION public.create_audit_log IS 'Cria um registro de audit log padronizado para rastreabilidade de operações CRUD';
