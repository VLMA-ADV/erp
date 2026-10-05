-- A NFS-e por caso somava TODO item 'aprovado' do caso, de qualquer mes. O kit
-- da Composicao e por competencia: caso 41 (A&S Fersa) mostrava R$ 6.476,52 em
-- outubro e a previa da nota vinha com R$ 12.953,05, porque a mensalidade de
-- setembro continuava aprovada. 42 casos tinham setembro e outubro aprovados
-- ao mesmo tempo (R$ 83.770,02 de setembro entrariam junto). Funcao nova, com
-- o mes como escopo; a antiga fica para quem chama sem competencia.
CREATE OR REPLACE FUNCTION public.get_billing_items_aprovados_escopo(p_tenant_id uuid, p_contrato_id uuid, p_caso_id uuid DEFAULT NULL::uuid, p_competencia date DEFAULT NULL::date)
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
      -- Despesa e reembolso, nao servico: vai na Nota de Despesas, nunca na
      -- NFS-e. Entrava aqui porque o filtro era so 'aprovado' (Filipe, 07/09,
      -- caso 1949: R$ 75 de despesa somados aos honorarios).
      AND bi.origem_tipo <> 'despesa'
      -- Emissao por CASO: quando p_caso_id vem, a nota cobre so aquele escopo.
      -- Nulo mantem o comportamento de sempre (contrato inteiro), para nao
      -- quebrar quem ja chama a funcao com dois argumentos.
      AND (p_caso_id IS NULL OR bi.caso_id = p_caso_id)
      -- Mes do kit (Filipe, 05/10, caso 41): a nota de outubro somava tambem a
      -- mensalidade de setembro que seguia 'aprovada'. Mesma regra de
      -- competencia da Composicao e da Revisao.
      AND (p_competencia IS NULL OR date_trunc('month', COALESCE(bi.periodo_inicio, bi.created_at::date))::date = date_trunc('month', p_competencia)::date)
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
        AND bi.origem_tipo <> 'despesa'
        AND (p_caso_id IS NULL OR bi.caso_id = p_caso_id)
        -- Mes do kit (Filipe, 05/10, caso 41): a nota de outubro somava tambem a
        -- mensalidade de setembro que seguia 'aprovada'. Mesma regra de
        -- competencia da Composicao e da Revisao.
        AND (p_competencia IS NULL OR date_trunc('month', COALESCE(bi.periodo_inicio, bi.created_at::date))::date = date_trunc('month', p_competencia)::date)
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
        AND bi.origem_tipo <> 'despesa'
    )
  );
END;
$function$

;
GRANT EXECUTE ON FUNCTION public.get_billing_items_aprovados_escopo(uuid, uuid, uuid, date) TO authenticated, service_role;
