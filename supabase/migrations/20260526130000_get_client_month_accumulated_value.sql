-- Acumulacao mensal de impostos (regra fiscal confirmada por Filipe 22/05/2026):
-- Quando o mesmo cliente tem 2+ notas emitidas no mesmo mes, os valores devem ser
-- SOMADOS para determinar se atingem o minimo de retencao de cada imposto.
CREATE OR REPLACE FUNCTION public.get_client_month_accumulated_value(
  p_tenant_id uuid,
  p_cliente_id uuid,
  p_competencia text  -- formato 'YYYY-MM'
)
RETURNS numeric
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public
AS $$
  SELECT COALESCE(SUM((bn.metadata->>'valor_total')::numeric), 0)
  FROM finance.billing_notes bn
  JOIN contracts.contratos ct ON ct.id = bn.contrato_id
  WHERE bn.tenant_id = p_tenant_id
    AND ct.cliente_id = p_cliente_id
    AND bn.status IN ('gerado')
    AND bn.tipo_documento = 'nota_fiscal_servico'
    AND TO_CHAR(bn.created_at, 'YYYY-MM') = p_competencia;
$$;

GRANT EXECUTE ON FUNCTION public.get_client_month_accumulated_value(uuid, uuid, text)
  TO authenticated, service_role;
