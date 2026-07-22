-- Faturamento — tomador da NFS-e vem do PAGADOR do caso, não do cliente do contrato.
--
-- O caso tem "Pagadores do serviço (rateio)" (contracts.casos.pagadores_servico,
-- jsonb [{cliente_id, percentual}]). A emissão ignorava isso e usava sempre o
-- cliente do contrato como tomador — faturando na entidade errada quando o
-- pagador é outro (228 casos hoje).
--
-- Esta versão resolve o tomador a partir do pagador do caso dos itens aprovados:
--   * 1 pagador único (sem rateio)  -> tomador = esse pagador
--   * pagadores divergentes entre casos, OU caso com rateio (2+ pagadores)
--     -> AMBÍGUO: tomador cai no cliente do contrato (fallback p/ preview) e
--        pagador_info.ambiguo = true; o edge emit-nfse BLOQUEIA a emissão nesse
--        caso, em vez de faturar errado. Split em N notas fica p/ fase seguinte.

CREATE OR REPLACE FUNCTION public.get_billing_items_aprovados_full(
  p_tenant_id uuid,
  p_contrato_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_contrato_cliente uuid;
  v_distinct_payers  integer;
  v_has_rateio       boolean;
  v_tomador_id       uuid;
BEGIN
  SELECT cliente_id INTO v_contrato_cliente
  FROM contracts.contratos WHERE id = p_contrato_id;

  -- Pagador efetivo por caso dos itens aprovados (1º do rateio, ou cliente do
  -- contrato se o caso não tem pagador definido). Conta pagadores distintos e
  -- marca se algum caso tem rateio multi-pagador.
  WITH billed AS (
    SELECT DISTINCT bi.caso_id
    FROM finance.billing_items bi
    WHERE bi.tenant_id = p_tenant_id
      AND bi.contrato_id = p_contrato_id
      AND bi.status = 'aprovado'
  ),
  pag AS (
    SELECT
      COALESCE((ca.pagadores_servico->0->>'cliente_id')::uuid, v_contrato_cliente) AS pagador,
      COALESCE(jsonb_array_length(ca.pagadores_servico), 0) AS n_pag
    FROM billed b
    LEFT JOIN contracts.casos ca ON ca.id = b.caso_id
  )
  SELECT count(DISTINCT pagador), COALESCE(bool_or(n_pag > 1), false)
  INTO v_distinct_payers, v_has_rateio
  FROM pag;

  IF v_distinct_payers = 1 AND NOT v_has_rateio THEN
    SELECT DISTINCT COALESCE((ca.pagadores_servico->0->>'cliente_id')::uuid, v_contrato_cliente)
    INTO v_tomador_id
    FROM finance.billing_items bi
    LEFT JOIN contracts.casos ca ON ca.id = bi.caso_id
    WHERE bi.tenant_id = p_tenant_id
      AND bi.contrato_id = p_contrato_id
      AND bi.status = 'aprovado';
  ELSE
    v_tomador_id := NULL;  -- ambíguo → edge bloqueia
  END IF;

  RETURN jsonb_build_object(
    'itens', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', bi.id,
        'caso_id', bi.caso_id,
        'valor', COALESCE(bi.valor_aprovado, bi.valor_revisado, 0),
        'snapshot', bi.snapshot
      ) ORDER BY bi.created_at)
      FROM finance.billing_items bi
      WHERE bi.tenant_id = p_tenant_id
        AND bi.contrato_id = p_contrato_id
        AND bi.status = 'aprovado'
    ), '[]'::jsonb),
    'contrato', (SELECT to_jsonb(ct) FROM contracts.contratos ct WHERE ct.id = p_contrato_id),
    -- tomador resolvido pelo pagador; se ambíguo, cai no cliente do contrato só
    -- para a prévia não quebrar (a emissão é bloqueada pelo edge via ambiguo).
    'tomador', (
      SELECT to_jsonb(cli) FROM crm.clientes cli
      WHERE cli.id = COALESCE(v_tomador_id, v_contrato_cliente)
    ),
    'grupo_imposto', (
      SELECT to_jsonb(gi) FROM contracts.grupos_impostos gi
      WHERE gi.id = (SELECT grupo_imposto_id FROM contracts.contratos WHERE id = p_contrato_id)
    ),
    'pagador_info', jsonb_build_object(
      'tomador_id', v_tomador_id,
      'contrato_cliente_id', v_contrato_cliente,
      'distinct_payers', v_distinct_payers,
      'has_rateio', v_has_rateio,
      'ambiguo', (v_tomador_id IS NULL),
      'tomador_diferente_do_contrato', (v_tomador_id IS NOT NULL AND v_tomador_id <> v_contrato_cliente)
    )
  );
END;
$function$;
