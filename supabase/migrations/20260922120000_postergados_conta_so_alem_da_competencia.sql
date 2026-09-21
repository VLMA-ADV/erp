-- Desde 31/08 (20260831120000) toda hora nasce com periodo_faturamento = mês
-- seguinte ao lançamento (competência padrão). get_faturamento_postergados,
-- escrito em 18/08, ainda tratava "periodo_faturamento > mês do lançamento"
-- como adiamento — e passou a listar TODAS as horas (2.733 em 21/09, sendo 6
-- postergadas de verdade). Postergado é o que está ALÉM da competência padrão.
CREATE OR REPLACE FUNCTION public.get_faturamento_postergados(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'finance', 'contracts', 'operations', 'crm', 'people', 'core'
AS $function$
DECLARE
  v_tenant_id uuid;
BEGIN
  p_user_id := COALESCE(auth.uid(), p_user_id);
  SELECT tenant_id INTO v_tenant_id FROM core.tenant_users
  WHERE user_id = p_user_id AND status = 'ativo' LIMIT 1;
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Usuário não associado a tenant'; END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(x ORDER BY x.periodo_novo, x.cliente_nome)
    FROM (
      -- 1. Itens de regra (mensalidade, projeto, parcela)
      SELECT a.id, 'regra'::text AS fonte, a.item_tipo, a.descricao, a.valor,
             a.competencia, a.periodo_novo, a.motivo,
             cs.numero AS caso_numero, cs.nome AS caso_nome,
             cl.nome AS cliente_nome, a.created_at
      FROM finance.faturamento_adiamentos a
      LEFT JOIN contracts.casos cs ON cs.id = a.caso_id
      LEFT JOIN contracts.contratos ct ON ct.id = cs.contrato_id
      LEFT JOIN crm.clientes cl ON cl.id = ct.cliente_id
      WHERE a.tenant_id = v_tenant_id AND a.desfeito_em IS NULL

      UNION ALL

      -- 2. Horas adiadas — moram em outro lugar (periodo_faturamento do
      --    timesheet), mas para quem olha a tela são a mesma coisa.
      SELECT t.id, 'hora'::text, 'timesheet',
             COALESCE(NULLIF(t.descricao, ''), 'Horas') ,
             (t.horas * COALESCE(public.resolver_valor_hora(t.caso_id, t.cargo_id), 0))::numeric(14,2),
             (date_trunc('month', t.data_lancamento) + interval '1 month')::date,
             t.periodo_faturamento,
             NULL,
             cs.numero, cs.nome, cl.nome, t.updated_at
      FROM operations.timesheets t
      LEFT JOIN contracts.casos cs ON cs.id = t.caso_id
      LEFT JOIN contracts.contratos ct ON ct.id = cs.contrato_id
      LEFT JOIN crm.clientes cl ON cl.id = ct.cliente_id
      WHERE t.tenant_id = v_tenant_id
        AND t.periodo_faturamento IS NOT NULL
        AND date_trunc('month', t.periodo_faturamento)::date > (date_trunc('month', t.data_lancamento) + interval '1 month')::date
    ) x
  ), '[]'::jsonb);
END;
$function$

;
