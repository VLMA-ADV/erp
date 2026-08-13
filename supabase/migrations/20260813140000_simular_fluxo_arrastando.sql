-- Simulacao de fluxo: arrastar a conta para outro dia (pedido Filipe 13/08).
--
-- Ele descreveu: "e literalmente um drag and drop para uma nova data... e
-- tambem um atalho para reagendar de forma mais simples". E: "eu gosto da tela
-- de seguranca, onde eu vejo um rascunho e aplico a alteracao mediante
-- confirmacao, tipo cancelar / confirmar".
--
-- Entao o rascunho e recalculado NO SERVIDOR, com p_simulacao, em vez de a tela
-- refazer a conta por fora. A regra de qual dia o dinheiro conta e delicada
-- (baixado conta na baixa, em aberto no vencimento, atrasado sobe pro dia 1) —
-- se a tela reimplementasse isso, bastaria uma divergencia para o rascunho
-- mostrar um caixa que nao vai acontecer, e o Filipe decidiria em cima dele.
-- Uma regra so, num lugar so.
--
-- p_simulacao: [{"id": "<uuid>", "vencimento": "2026-08-30"}]
-- Nada e gravado aqui. Quem confirma o rascunho e a tela, chamando cp_reagendar
-- em cada linha movida — que ja existe, ja valida e ja deixa rastro em
-- reagendado_de.

-- A versao de 2 parametros precisa SAIR: com ela no banco, uma chamada de dois
-- argumentos casaria com as duas (a nova tem default no terceiro) e o Postgres
-- recusa com "function is not unique" — a tela quebraria inteira. A nova cobre
-- o caso antigo pelo default.
DROP FUNCTION IF EXISTS public.cp_fluxo_mensal(uuid, date);

CREATE OR REPLACE FUNCTION public.cp_fluxo_mensal(p_user_id uuid, p_mes date DEFAULT NULL::date, p_simulacao jsonb DEFAULT '[]'::jsonb)
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
      -- Simulacao (arrastar para outro dia): so vale para conta EM ABERTO.
      -- Ja baixada nao se simula — o dinheiro andou, a data nao e mais uma
      -- escolha. Assim o rascunho nunca mostra um caixa que nao pode existir.
      CASE WHEN l.status IN ('pago', 'recebido') THEN COALESCE(l.baixa_data, l.vencimento)
           ELSE COALESCE(sim.nova_data, l.vencimento) END AS data_real,
      CASE WHEN l.status IN ('pago', 'recebido') THEN COALESCE(l.baixa_valor, l.valor)
           ELSE l.valor END AS valor_real
    FROM finance.lancamentos l
    LEFT JOIN LATERAL (
      SELECT NULLIF(x->>'vencimento', '')::date AS nova_data
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_simulacao) = 'array' THEN p_simulacao ELSE '[]'::jsonb END) x
      WHERE NULLIF(x->>'id', '')::uuid = l.id
      LIMIT 1
    ) sim ON true
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
               valor, data_real AS vencimento, vencimento AS vencimento_original,
               status, reembolsavel, veio_atrasado
        FROM no_mes WHERE natureza = 'pagar'
      ) x), '[]'::jsonb),
    'receber', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.vencimento, x.descricao) FROM (
        SELECT id, descricao, cliente_id, empresa_nome, conta_codigo, plano_grupo, centro_nome,
               valor, data_real AS vencimento, vencimento AS vencimento_original,
               status, reembolso_de_id, veio_atrasado
        FROM no_mes WHERE natureza = 'receber'
      ) x), '[]'::jsonb)
  ) INTO v_out;

  RETURN v_out;
END;
$function$
;
