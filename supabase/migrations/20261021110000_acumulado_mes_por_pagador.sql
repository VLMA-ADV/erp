-- Acumulado do mês para os mínimos de retenção POR PAGADOR (out/2026,
-- aprovado pelo cliente).
--
-- A versão de 20260526130000 somava as NFS-e do mês pelo CLIENTE DO CONTRATO
-- (ct.cliente_id). Com rateio ou pagador trocado na emissão, a nota de um
-- pagador entrava no acumulado de quem é dono do contrato, e não no de quem
-- recebeu a nota. Agora soma pelo tomador da nota: o pagador gravado em
-- metadata.pagador_cliente_id pela emit-nfse e, em nota antiga sem esse
-- campo, o cliente do contrato (que era o tomador nesses casos).
--
-- Quem chama: a emit-nfse (antes de cada nota, com o pagador da nota), a
-- prévia da NFS-e (nfse-preview-dialog → lib/faturamento/impostos-nfse) e
-- get_quadro_impostos_kit (quadro de impostos do relatório).
--
-- Resto igual: só notas 'gerado', mês 'YYYY-MM' de created_at.
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
    AND COALESCE(NULLIF(bn.metadata->>'pagador_cliente_id', '')::uuid, ct.cliente_id) = p_cliente_id
    AND bn.status IN ('gerado')
    AND bn.tipo_documento = 'nota_fiscal_servico'
    AND TO_CHAR(bn.created_at, 'YYYY-MM') = p_competencia;
$$;

GRANT EXECUTE ON FUNCTION public.get_client_month_accumulated_value(uuid, uuid, text)
  TO authenticated, service_role;
