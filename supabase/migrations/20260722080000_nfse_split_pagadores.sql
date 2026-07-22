-- Faturamento — divisão da NFS-e por pagador (rateio). Fase B.
--
-- Regra confirmada pelo cliente (22/07): cada pagador paga a sua parte
-- PROPORCIONAL ao percentual definido no rateio do caso → uma NFS-e por pagador.
--
-- get_billing_items_aprovados_full passa a retornar `pagadores`: um item por
-- pagador distinto, com o valor total dele (soma das fatias proporcionais dos
-- itens aprovados) e os item_ids que o compõem. Caso sem rateio (ou vazio)
-- resolve para um único pagador = cliente do contrato, a 100% — então o caminho
-- de pagador único continua sendo "1 pagador → 1 nota", sem regressão.
--
-- Mantém `tomador` (= pagador principal) e `pagador_info` para compatibilidade
-- com a prévia. A emissão (edge) passa a usar `pagadores`.

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
  v_pagadores jsonb;
  v_tomador_principal uuid;
BEGIN
  SELECT cliente_id INTO v_contrato_cliente
  FROM contracts.contratos WHERE id = p_contrato_id;

  -- Fatias por pagador dos itens aprovados. Para cada item, se o caso tem rateio
  -- (pagadores_servico não vazio) distribui pelo percentual de cada pagador;
  -- senão, 100% para o cliente do contrato.
  WITH aprov AS (
    SELECT bi.id,
           COALESCE(bi.valor_aprovado, bi.valor_revisado, 0)::numeric AS valor,
           ca.pagadores_servico AS pg
    FROM finance.billing_items bi
    LEFT JOIN contracts.casos ca ON ca.id = bi.caso_id
    WHERE bi.tenant_id = p_tenant_id
      AND bi.contrato_id = p_contrato_id
      AND bi.status = 'aprovado'
  ),
  shares AS (
    SELECT a.id,
           COALESCE((p.value->>'cliente_id')::uuid, v_contrato_cliente) AS payer,
           a.valor * COALESCE((p.value->>'percentual')::numeric, 100) / 100.0 AS fatia
    FROM aprov a
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE
        WHEN jsonb_typeof(a.pg) = 'array' AND jsonb_array_length(a.pg) > 0 THEN a.pg
        ELSE jsonb_build_array(jsonb_build_object('cliente_id', v_contrato_cliente, 'percentual', 100))
      END
    ) AS p(value)
  ),
  agg AS (
    SELECT payer,
           round(sum(fatia), 2) AS valor_total,
           jsonb_agg(DISTINCT id) AS item_ids
    FROM shares
    GROUP BY payer
  )
  SELECT jsonb_agg(jsonb_build_object(
    'cliente_id', payer,
    'cliente', (SELECT to_jsonb(cli) FROM crm.clientes cli WHERE cli.id = payer),
    'valor_total', valor_total,
    'item_ids', item_ids
  ) ORDER BY valor_total DESC)
  INTO v_pagadores
  FROM agg;

  v_pagadores := COALESCE(v_pagadores, '[]'::jsonb);
  v_tomador_principal := COALESCE((v_pagadores->0->>'cliente_id')::uuid, v_contrato_cliente);

  RETURN jsonb_build_object(
    'itens', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', bi.id, 'caso_id', bi.caso_id,
        'valor', COALESCE(bi.valor_aprovado, bi.valor_revisado, 0),
        'snapshot', bi.snapshot
      ) ORDER BY bi.created_at)
      FROM finance.billing_items bi
      WHERE bi.tenant_id = p_tenant_id AND bi.contrato_id = p_contrato_id AND bi.status = 'aprovado'
    ), '[]'::jsonb),
    'contrato', (SELECT to_jsonb(ct) FROM contracts.contratos ct WHERE ct.id = p_contrato_id),
    'tomador', (SELECT to_jsonb(cli) FROM crm.clientes cli WHERE cli.id = v_tomador_principal),
    'grupo_imposto', (SELECT to_jsonb(gi) FROM contracts.grupos_impostos gi WHERE gi.id = (SELECT grupo_imposto_id FROM contracts.contratos WHERE id = p_contrato_id)),
    'pagadores', v_pagadores,
    'pagador_info', jsonb_build_object(
      'contrato_cliente_id', v_contrato_cliente,
      'n_pagadores', jsonb_array_length(v_pagadores),
      'multi', jsonb_array_length(v_pagadores) > 1,
      'tomador_diferente_do_contrato', (v_tomador_principal <> v_contrato_cliente)
    )
  );
END;
$function$;
