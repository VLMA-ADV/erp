-- RPCs SECURITY DEFINER para emit-nfse acessar finance sem schema routing
-- Evita dependência de pgrst.db_schemas expor finance ao PostgREST

CREATE OR REPLACE FUNCTION public.get_billing_items_aprovados(
  p_tenant_id    uuid,
  p_contrato_id  uuid    DEFAULT NULL,
  p_item_ids     uuid[]  DEFAULT NULL
)
RETURNS TABLE (
  id             uuid,
  contrato_id    uuid,
  caso_id        uuid,
  valor_aprovado numeric,
  valor_revisado numeric,
  valor          numeric,
  snapshot       jsonb,
  status         text
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    id, contrato_id, caso_id,
    valor_aprovado, valor_revisado, valor,
    snapshot, status
  FROM finance.billing_items
  WHERE tenant_id = p_tenant_id
    AND status = 'aprovado'
    AND (p_contrato_id IS NULL OR contrato_id = p_contrato_id)
    AND (p_item_ids    IS NULL OR id = ANY(p_item_ids));
$$;

CREATE OR REPLACE FUNCTION public.insert_billing_note(
  p_tenant_id      uuid,
  p_contrato_id    uuid,
  p_tipo_documento text,
  p_status         text,
  p_focus_ref      text,
  p_focus_status   text,
  p_metadata       jsonb,
  p_created_by     uuid
)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO finance.billing_notes (
    tenant_id, contrato_id, tipo_documento,
    status, focus_ref, focus_status, metadata, created_by
  )
  VALUES (
    p_tenant_id, p_contrato_id, p_tipo_documento,
    p_status, p_focus_ref, p_focus_status, p_metadata, p_created_by
  )
  RETURNING id;
$$;
