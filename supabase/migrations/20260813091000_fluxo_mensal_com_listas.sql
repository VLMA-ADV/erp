-- cp_fluxo_mensal passa a devolver tambem as LISTAS do mes.
--
-- O pedido do Filipe e "filtrar as contas a pagar e receber por mes", nao so
-- ver o grafico: as duas colunas embaixo tem que mostrar o mes escolhido. As
-- listas usam exatamente a mesma regra de dia efetivo do grafico (baixado conta
-- no dia da baixa, em aberto no vencimento, atrasado sobe pro dia 1) — se
-- usassem regra diferente, a soma da coluna nao bateria com a linha do grafico
-- logo acima, e nao haveria como saber qual das duas esta certa.
--
-- Os campos de cada linha sao os mesmos que cp_rotina_diaria ja devolve, para a
-- tela reaproveitar o mesmo componente de lista sem traducao no meio.
CREATE OR REPLACE FUNCTION public.cp_fluxo_mensal(p_user_id uuid, p_mes date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'finance', 'core'
AS $function$
DECLARE
  v_tenant uuid;
  v_mes_inicio date;
  v_mes_fim date;
  v_saldo_abertura numeric(14,2);
  v_baixas_antes numeric(14,2);
  v_saldo_inicial numeric(14,2);
  v_out jsonb;
BEGIN
  v_tenant := finance._cp_tenant(p_user_id);
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem tenant'; END IF;
  IF NOT finance._cp_pode(p_user_id, 'finance.contas_pagar.read') THEN
    RAISE EXCEPTION 'Sem permissão'; END IF;

  v_mes_inicio := date_trunc('month', COALESCE(p_mes, CURRENT_DATE))::date;
  v_mes_fim := (v_mes_inicio + interval '1 month - 1 day')::date;

  SELECT COALESCE(SUM(cb.saldo_abertura), 0) INTO v_saldo_abertura
  FROM finance.contas_bancarias cb WHERE cb.tenant_id = v_tenant AND cb.ativo;

  SELECT COALESCE(SUM(
    CASE WHEN l.natureza = 'receber' THEN COALESCE(l.baixa_valor, l.valor)
         ELSE -COALESCE(l.baixa_valor, l.valor) END
  ), 0) INTO v_baixas_antes
  FROM finance.lancamentos l
  WHERE l.tenant_id = v_tenant
    AND l.status IN ('pago', 'recebido')
    AND COALESCE(l.baixa_data, l.vencimento) < v_mes_inicio;

  v_saldo_inicial := v_saldo_abertura + v_baixas_antes;

  WITH mov AS (
    SELECT
      l.*,
      COALESCE(pc.codigo || ' — ' || pc.analitica, cc.codigo) AS conta_codigo,
      pc.grupo AS plano_grupo,
      ce.nome AS centro_nome,
      e.nome AS empresa_nome,
      CASE WHEN l.status IN ('pago', 'recebido') THEN COALESCE(l.baixa_data, l.vencimento)
           ELSE l.vencimento END AS data_real,
      CASE WHEN l.status IN ('pago', 'recebido') THEN COALESCE(l.baixa_valor, l.valor)
           ELSE l.valor END AS valor_real
    FROM finance.lancamentos l
    LEFT JOIN finance.plano_contas pc ON pc.id = l.plano_conta_id
    LEFT JOIN finance.contas_contabeis cc ON cc.id = l.conta_contabil_id
    LEFT JOIN finance.centros_custo ce ON ce.id = l.centro_custo_id
    LEFT JOIN finance.empresas_grupo e ON e.id = l.empresa_id
    WHERE l.tenant_id = v_tenant
      AND l.status <> 'cancelado'
  ),
  no_mes AS (
    SELECT
      *,
      GREATEST(data_real, v_mes_inicio) AS dia,
      (data_real < v_mes_inicio) AS veio_atrasado
    FROM mov
    WHERE data_real <= v_mes_fim
      AND (data_real >= v_mes_inicio OR status NOT IN ('pago', 'recebido'))
  ),
  dias AS (
    SELECT gs::date AS dia
    FROM generate_series(v_mes_inicio, v_mes_fim, interval '1 day') gs
  ),
  por_dia AS (
    SELECT
      d.dia,
      COALESCE(SUM(m.valor_real) FILTER (WHERE m.natureza = 'pagar'), 0)::numeric(14,2) AS pagar,
      COALESCE(SUM(m.valor_real) FILTER (WHERE m.natureza = 'receber'), 0)::numeric(14,2) AS receber
    FROM dias d
    LEFT JOIN no_mes m ON m.dia = d.dia
    GROUP BY d.dia
  ),
  acumulado AS (
    SELECT
      dia, pagar, receber,
      (v_saldo_inicial + SUM(receber - pagar) OVER (ORDER BY dia))::numeric(14,2) AS saldo_projetado
    FROM por_dia
  )
  SELECT jsonb_build_object(
    'mes_inicio', v_mes_inicio,
    'mes_fim', v_mes_fim,
    'saldo_inicial', v_saldo_inicial,
    'dias', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object('data', dia, 'pagar', pagar, 'receber', receber, 'saldo_projetado', saldo_projetado)
        ORDER BY dia
      ) FROM acumulado
    ), '[]'::jsonb),
    'total_pagar', COALESCE((SELECT SUM(pagar) FROM acumulado), 0),
    'total_receber', COALESCE((SELECT SUM(receber) FROM acumulado), 0),
    'saldo_final', COALESCE((SELECT saldo_projetado FROM acumulado ORDER BY dia DESC LIMIT 1), v_saldo_inicial),
    'atrasado_anterior', jsonb_build_object(
      'pagar', COALESCE((SELECT SUM(valor_real) FROM no_mes WHERE veio_atrasado AND natureza = 'pagar'), 0),
      'receber', COALESCE((SELECT SUM(valor_real) FROM no_mes WHERE veio_atrasado AND natureza = 'receber'), 0)
    ),
    'pagar', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.vencimento, x.descricao) FROM (
        SELECT id, descricao, fornecedor_nome, empresa_nome, conta_codigo, plano_grupo, centro_nome,
               valor, vencimento, status, reembolsavel, veio_atrasado
        FROM no_mes WHERE natureza = 'pagar'
      ) x), '[]'::jsonb),
    'receber', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.vencimento, x.descricao) FROM (
        SELECT id, descricao, cliente_id, empresa_nome, conta_codigo, plano_grupo, centro_nome,
               valor, vencimento, status, reembolso_de_id, veio_atrasado
        FROM no_mes WHERE natureza = 'receber'
      ) x), '[]'::jsonb)
  ) INTO v_out;

  RETURN v_out;
END;
$function$;
