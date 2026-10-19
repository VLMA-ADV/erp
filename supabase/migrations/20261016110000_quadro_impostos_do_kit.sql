-- Quadro "Impostos" por pagador no relatório de timesheet (cliente, out/2026).
-- O relatório é montado no navegador a partir de get_composicao_fatura, que
-- traz das NFS-e do kit só número, valor e pagador — não as retenções. E as
-- RPCs que a emissão usa para a estimativa (nfse_grupo_imposto) foram feitas
-- para a service role e recebem o tenant de quem chama. Esta função, só de
-- leitura, devolve numa chamada o que o quadro precisa, com o tenant e a
-- permissão de quem está logado (mesma regra de get_composicao_fatura):
--   grupo      — a linha de contracts.grupos_impostos do kit (retem_*, alíquotas, mínimos);
--   acumulados — get_client_month_accumulated_value de cada pagador, no mesmo
--                mês que a emit-nfse passa (data da emissão em Brasília);
--   notas      — retenções REAIS de cada NFS-e (o que foi à prefeitura em
--                metadata.focus_request) e o líquido por finance.valor_liquido_da_nota.
CREATE OR REPLACE FUNCTION public.get_quadro_impostos_kit(
  p_user_id uuid,
  p_grupo_id uuid DEFAULT NULL,
  p_nota_ids uuid[] DEFAULT NULL,
  p_cliente_ids uuid[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'finance', 'contracts', 'crm', 'core'
AS $function$
DECLARE
  v_tenant uuid;
  -- emit-nfse: dataCompetencia = isoBrt(60).slice(0, 10) → 'YYYY-MM'.
  v_mes text := to_char((now() AT TIME ZONE 'America/Sao_Paulo') - interval '60 seconds', 'YYYY-MM');
BEGIN
  SELECT tenant_id INTO v_tenant FROM core.tenant_users
   WHERE user_id = p_user_id AND status = 'ativo' LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem tenant'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.get_user_permissions(p_user_id) p
    WHERE p.permission_key IN ('finance.faturamento.read', 'finance.faturamento.manage',
                               'finance.faturamento.*', 'finance.*', '*')
  ) THEN
    RAISE EXCEPTION 'Sem permissão para ver a composição da fatura';
  END IF;

  RETURN jsonb_build_object(
    'mes', v_mes,
    'grupo', (SELECT to_jsonb(g) FROM contracts.grupos_impostos g
               WHERE g.id = p_grupo_id AND g.tenant_id = v_tenant),
    'acumulados', COALESCE((
      SELECT jsonb_object_agg(c.id, public.get_client_month_accumulated_value(v_tenant, c.id, v_mes))
        FROM (SELECT DISTINCT unnest(p_cliente_ids) AS id) c
       WHERE c.id IS NOT NULL
    ), '{}'::jsonb),
    'notas', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'nota_id', bn.id,
               'pagador_cliente_id', pg.id,
               'pagador_nome', pc.nome,
               'nfse_numero', COALESCE(NULLIF(bn.metadata->'nfse_consulta'->>'numero_nfse', ''),
                                       NULLIF(bn.metadata->>'nfse_numero', '')),
               'valor_total', NULLIF(bn.metadata->>'valor_total', '')::numeric,
               'valor_irrf', COALESCE(NULLIF(r.q->>'valor_irrf', '')::numeric, 0),
               'valor_pis', COALESCE(NULLIF(r.q->>'valor_pis', '')::numeric, 0),
               'valor_cofins', COALESCE(NULLIF(r.q->>'valor_cofins', '')::numeric, 0),
               -- valor_csll do pedido JÁ É a retenção unificada (ver 20261005100000)
               'valor_pis_cofins_csll', COALESCE(NULLIF(r.q->>'valor_csll', '')::numeric,
                                                 COALESCE(NULLIF(r.q->>'valor_pis', '')::numeric, 0)
                                               + COALESCE(NULLIF(r.q->>'valor_cofins', '')::numeric, 0)),
               'valor_inss', COALESCE(NULLIF(r.q->>'valor_inss', '')::numeric, 0),
               'valor_iss_retido', CASE WHEN COALESCE(NULLIF(r.q->>'tipo_retencao_iss', '')::int, 1) IN (2, 3)
                                        THEN COALESCE(NULLIF(r.q->>'valor_iss', '')::numeric,
                                                      NULLIF(bn.metadata->>'valor_iss', '')::numeric, 0)
                                        ELSE 0 END,
               'valor_liquido', finance.valor_liquido_da_nota(bn.metadata)
             ) ORDER BY bn.created_at)
        FROM finance.billing_notes bn
        JOIN contracts.contratos ct ON ct.id = bn.contrato_id
        CROSS JOIN LATERAL (SELECT COALESCE(bn.metadata->'focus_request', '{}'::jsonb) AS q) r
        CROSS JOIN LATERAL (SELECT COALESCE(NULLIF(bn.metadata->>'pagador_cliente_id', '')::uuid, ct.cliente_id) AS id) pg
        LEFT JOIN crm.clientes pc ON pc.id = pg.id
       WHERE bn.tenant_id = v_tenant
         AND bn.id = ANY(COALESCE(p_nota_ids, '{}'::uuid[]))
         AND bn.tipo_documento = 'nota_fiscal_servico'
    ), '[]'::jsonb)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_quadro_impostos_kit(uuid, uuid, uuid[], uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_quadro_impostos_kit(uuid, uuid, uuid[], uuid[]) TO authenticated, service_role;
