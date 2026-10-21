-- =====================================================================
-- "Faturado no mês" com linha própria de Mensalidade de carteira.
--
-- A Revisão de fatura ganhou a aba "Mensalidade de carteira" (pedido do
-- Filipe, 29/09: "na regra de cobrança 'mensalidade de carteira' queria que
-- tivesse uma aba aqui no faturamento"). O painel "Andamento por regra" casa
-- esta RPC pela chave; sem esta mudança o faturado da carteira continuaria
-- somado em "Mensalidade" e a linha da carteira mostraria zero.
--
-- Única mudança em relação à versão de produção (20260910100000): a regra
-- 'mensalidade_carteira' sai do grupo 'mensalidade' e vira chave própria.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.get_faturado_mes_por_regra(p_user_id uuid, p_mes date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'finance', 'contracts', 'core'
AS $function$
DECLARE
  v_tenant uuid;
  v_ini date := date_trunc('month', COALESCE(p_mes, CURRENT_DATE))::date;
  v_fim date := (date_trunc('month', COALESCE(p_mes, CURRENT_DATE)) + interval '1 month')::date;
BEGIN
  SELECT tenant_id INTO v_tenant FROM core.tenant_users
   WHERE user_id = p_user_id AND status = 'ativo' LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem tenant'; END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object('key', x.key, 'itens', x.itens, 'valor', x.valor))
    FROM (
      SELECT
        CASE
          WHEN bi.origem_tipo = 'despesa' THEN 'despesa'
          WHEN r.regra IN ('hora', 'hora_com_cap') THEN 'hora'
          WHEN r.regra = 'mensalidade_processo' THEN 'mensalidade_processo'
          WHEN r.regra = 'mensalidade_carteira' THEN 'mensalidade_carteira'
          WHEN r.regra IN ('mensal', 'salario_minimo') THEN 'mensalidade'
          WHEN r.regra IN ('projeto', 'pro_labore') THEN 'projeto'
          WHEN r.regra IN ('projeto_parcela', 'projeto_parcelado', 'pro_labore_parcelado') THEN 'projeto_parcelado'
          WHEN r.regra = 'exito' THEN 'exito'
          ELSE 'outros'
        END AS key,
        count(DISTINCT bi.id) AS itens,
        SUM(COALESCE(bi.valor_aprovado, bi.valor_revisado, bi.valor_informado, 0)) AS valor
      FROM finance.billing_notes bn
      JOIN LATERAL jsonb_array_elements_text(COALESCE(bn.metadata->'item_ids', '[]'::jsonb)) ids(id) ON true
      JOIN finance.billing_items bi ON bi.id = ids.id::uuid AND bi.tenant_id = v_tenant
      LEFT JOIN contracts.casos cs ON cs.id = bi.caso_id
      CROSS JOIN LATERAL (
        SELECT lower(COALESCE(NULLIF(bi.snapshot->>'regra_cobranca', ''), cs.regra_cobranca, '')) AS regra
      ) r
      WHERE bn.tenant_id = v_tenant
        AND bn.status = 'gerado'
        AND bn.created_at >= v_ini AND bn.created_at < v_fim
        AND bi.status = 'faturado'
      GROUP BY 1
    ) x
  ), '[]'::jsonb);
END $function$;

REVOKE ALL ON FUNCTION public.get_faturado_mes_por_regra(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_faturado_mes_por_regra(uuid, date) TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';
