-- =====================================================================
-- Previa da NFS-e: avisar o que do contrato ficou de fora
--
-- Filipe, 20/08, caso Pattac: "o relatorio esta trazendo os 3 casos, mas a
-- nota fiscal nao vem somado. Quer dar uma olhada?".
--
-- Nao era bug de agrupamento. Reproduzi no contrato da Pattac: com um caso
-- aprovado a nota somou R$ 1.500; aprovando o segundo, somou R$ 4.300. A nota
-- SEMPRE juntou os casos do contrato — ela so conta os itens com status
-- 'aprovado'. Com parte dos casos ainda em revisao, ela sai curta.
--
-- O comportamento esta certo: nao se fatura o que nao foi aprovado. O que
-- faltava era a tela DIZER isso, em vez de deixar o numero parecer errado.
-- Agora a funcao devolve tambem o que ficou de fora, e a previa avisa.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.get_billing_items_aprovados_full(p_tenant_id uuid, p_contrato_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
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
    ),
    -- O que existe no contrato e NAO entra nesta nota, por ainda nao estar
    -- aprovado. A nota sempre somou o contrato inteiro, mas so a parte
    -- aprovada — e a tela nao dizia isso, entao quem tinha dois casos e
    -- aprovou um via a nota "nao somar" e parecia bug de agrupamento
    -- (Filipe, 20/08, caso Pattac).
    'pendentes', (
      SELECT jsonb_build_object(
        'itens', COUNT(*),
        'casos', COUNT(DISTINCT bi.caso_id),
        'valor', COALESCE(SUM(COALESCE(bi.valor_revisado, 0)), 0),
        'casos_nomes', COALESCE(jsonb_agg(DISTINCT COALESCE(ca.nome, 'sem caso')), '[]'::jsonb)
      )
      FROM finance.billing_items bi
      LEFT JOIN contracts.casos ca ON ca.id = bi.caso_id
      WHERE bi.tenant_id = p_tenant_id
        AND bi.contrato_id = p_contrato_id
        AND bi.status NOT IN ('aprovado', 'cancelado', 'faturado')
    )
  );
END;
$function$;


