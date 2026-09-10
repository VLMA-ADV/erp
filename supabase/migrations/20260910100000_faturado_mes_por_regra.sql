-- =====================================================================
-- Faturado no mes, por regra de cobranca — coluna do painel "Andamento por
-- regra" (aba Indicadores da Revisao). Filipe, 10/09, resposta 1.2 "a+b":
-- quer o faturado do mes inteiro, nao so o que ainda esta na fila.
--
-- Item faturado sai da fila quando a nota e emitida, entao a tela sozinha
-- nao sabe quanto ja foi faturado no mes. Aqui: itens 'faturado' ligados a
-- notas emitidas (nao canceladas) criadas no mes pedido, agrupados pela
-- mesma chave de regra que a tela usa nas abas.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.get_faturado_mes_por_regra(p_user_id uuid, p_mes date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'finance', 'contracts', 'core'
AS $$
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
          WHEN r.regra IN ('mensal', 'mensalidade_carteira', 'salario_minimo') THEN 'mensalidade'
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
END $$;

REVOKE ALL ON FUNCTION public.get_faturado_mes_por_regra(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_faturado_mes_por_regra(uuid, date) TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';
