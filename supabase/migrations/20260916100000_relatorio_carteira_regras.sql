-- =====================================================================
-- Relatório de carteira: cliente → contrato → caso → regra de cobrança
--
-- Filipe, 11/09: "É possível gerar um relatório contendo cliente, contrato,
-- caso e regra de cobrança? Após o faturamento, gostaria de conferir essas
-- informações, pois verifiquei alguns casos por hora sem regra de cobrança e
-- alguns valores fixos que estão sendo considerados conforme os lançamentos
-- de horas". Resposta dele em 16/09: carteira inteira, com filtro de quem
-- faturou no mês.
--
-- Uma linha por caso ativo. Alem do cadastro, tres alertas, que sao o motivo
-- do pedido:
--   sem_regra          — caso sem regra de cobranca definida
--   hora_sem_valor     — cobra por hora mas nao tem valor/hora
--   fixo_com_horas     — regra de valor fixo e mesmo assim ha horas com valor
--                        na fila (o que ele viu acontecendo)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.get_relatorio_carteira_regras(
  p_user_id uuid,
  p_mes date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'contracts', 'crm', 'finance', 'core'
AS $$
DECLARE
  v_tenant uuid;
  v_ini date := date_trunc('month', COALESCE(p_mes, CURRENT_DATE))::date;
  v_fim date := (date_trunc('month', COALESCE(p_mes, CURRENT_DATE)) + interval '1 month')::date;
BEGIN
  SELECT tenant_id INTO v_tenant FROM core.tenant_users
   WHERE user_id = p_user_id AND status = 'ativo' LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem tenant'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.get_user_permissions(p_user_id) p
    WHERE p.permission_key IN ('reports.view', 'finance.faturamento.read',
                               'finance.faturamento.manage', 'finance.*', '*')
  ) THEN
    RAISE EXCEPTION 'Sem permissão para ver relatórios';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(to_jsonb(x) ORDER BY x.cliente, x.contrato_numero, x.caso_numero)
    FROM (
      SELECT
        cl.nome                              AS cliente,
        ct.numero_sequencial                 AS contrato_numero,
        ct.nome_contrato                     AS contrato_nome,
        ct.status                            AS contrato_status,
        cs.numero                            AS caso_numero,
        cs.nome                              AS caso_nome,
        cs.status                            AS caso_status,
        COALESCE(NULLIF(r.regra, ''), '—')   AS regra_cobranca,
        public.resolver_valor_hora(cs.id, NULL) AS valor_hora,
        NULLIF(r.cfg->>'valor_fixo', '')::numeric  AS valor_fixo,
        NULLIF(r.cfg->>'valor', '')::numeric       AS valor_regra,
        cs.pagamento_dia_mes                 AS dia_pagamento,
        resp.nome                            AS responsavel,
        f.itens                              AS itens_no_mes,
        f.horas                              AS horas_no_mes,
        f.valor                              AS valor_no_mes,
        (f.itens > 0)                        AS faturou_no_mes,
        (COALESCE(NULLIF(r.regra, ''), '') = '')                    AS alerta_sem_regra,
        (r.regra IN ('hora', 'hora_com_cap')
          AND COALESCE(public.resolver_valor_hora(cs.id, NULL), 0) = 0) AS alerta_hora_sem_valor,
        (r.regra IN ('mensal', 'mensalidade_processo', 'mensalidade_carteira',
                     'salario_minimo', 'projeto', 'projeto_parcela', 'projeto_parcelado',
                     'pro_labore', 'pro_labore_parcelado')
          AND COALESCE(h.valor_horas, 0) > 0)                       AS alerta_fixo_com_horas
      FROM contracts.casos cs
      JOIN contracts.contratos ct ON ct.id = cs.contrato_id
      JOIN crm.clientes cl ON cl.id = ct.cliente_id
      LEFT JOIN people.colaboradores resp ON resp.id = cs.responsavel_id
      CROSS JOIN LATERAL (
        SELECT
          lower(COALESCE(NULLIF(cs.regras_financeiras->0->>'regra_cobranca', ''), cs.regra_cobranca, '')) AS regra,
          COALESCE(cs.regras_financeiras->0->'regra_cobranca_config', cs.regra_cobranca_config, '{}'::jsonb) AS cfg
      ) r
      -- Faturamento do mes pedido: notas emitidas (nao canceladas) no periodo.
      LEFT JOIN LATERAL (
        SELECT count(DISTINCT bi.id) AS itens,
               ROUND(SUM(COALESCE(bi.horas_aprovadas, bi.horas_revisadas, bi.horas_informadas, 0))::numeric, 2) AS horas,
               ROUND(SUM(COALESCE(bi.valor_aprovado, bi.valor_revisado, bi.valor_informado, 0))::numeric, 2) AS valor
        FROM finance.billing_notes bn
        JOIN LATERAL jsonb_array_elements_text(COALESCE(bn.metadata->'item_ids', '[]'::jsonb)) ids(id) ON true
        JOIN finance.billing_items bi ON bi.id = ids.id::uuid AND bi.caso_id = cs.id
        WHERE bn.tenant_id = v_tenant
          AND bn.status = 'gerado'
          AND bn.created_at >= v_ini AND bn.created_at < v_fim
      ) f ON true
      -- Horas com valor na fila: e o sintoma do "valor fixo cobrando hora".
      LEFT JOIN LATERAL (
        SELECT SUM(COALESCE(bi.valor_aprovado, bi.valor_revisado, bi.valor_informado, 0)) AS valor_horas
        FROM finance.billing_items bi
        WHERE bi.caso_id = cs.id
          AND bi.origem_tipo = 'timesheet'
          AND bi.status IN ('em_revisao', 'em_aprovacao', 'aprovado', 'faturado')
      ) h ON true
      WHERE cs.tenant_id = v_tenant
        AND cs.status <> 'inativo'
        AND ct.status <> 'encerrado'
    ) x
  ), '[]'::jsonb);
END $$;

REVOKE ALL ON FUNCTION public.get_relatorio_carteira_regras(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_relatorio_carteira_regras(uuid, date) TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';
