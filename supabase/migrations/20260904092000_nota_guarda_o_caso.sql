-- =====================================================================
-- A nota guarda o caso que ela cobre
--
-- Sem isto a nota emitida por caso nao tem como ser localizada na linha do
-- caso: a composicao e o boleto procurariam por contrato e achariam todas as
-- notas do contrato juntas.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.insert_billing_note(p_tenant_id uuid, p_contrato_id uuid, p_tipo_documento text, p_status text, p_focus_ref text, p_focus_status text, p_metadata jsonb, p_created_by uuid, p_caso_id uuid DEFAULT NULL)
 RETURNS uuid
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  INSERT INTO finance.billing_notes (
    tenant_id, contrato_id, tipo_documento, status, focus_ref, focus_status, metadata, created_by
  , caso_id) VALUES (
    p_tenant_id, p_contrato_id, p_tipo_documento, p_status, p_focus_ref, p_focus_status, p_metadata, p_created_by
  , p_caso_id) RETURNING id;
$function$;

-- Assinatura antiga sai: com a nova tendo p_caso_id DEFAULT, as duas convivem
-- e o Postgres recusa por ambiguidade.
DROP FUNCTION IF EXISTS public.insert_billing_note(uuid, uuid, text, text, text, text, jsonb, uuid);
